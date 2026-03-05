#!/usr/bin/env python3
"""
Deep Pipeline Phase 4: Hierarchical Card Generation
Creates domain-based Epics, Stories, and Tasks from real code analysis.
"""
import uuid
import json
import psycopg2
import requests
from datetime import datetime

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
OLLAMA_URL = "http://172.27.144.1:11434"

def get_embedding(text: str) -> list:
    resp = requests.post(f"{OLLAMA_URL}/api/embeddings", json={
        "model": "nomic-embed-text",
        "prompt": text[:2000]
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]

# Full card hierarchy based on real code analysis of 18 domains
HIERARCHY = [
    # ============================================================
    # EPIC 1: AI Orchestration & Multi-Provider Engine
    # ============================================================
    {
        "type": "epic", "title": "Orquestração Multi-Provider de IA",
        "description": "Motor central de orquestração que gerencia chamadas a 4 provedores (Anthropic, OpenAI, Google, Ollama) com fallback automático, rate limiting, e logging de uso. Implementado em AIOrchestrator com pattern Strategy para adapters de provider.",
        "priority": "critical", "story_points": 21, "status": "done",
        "stories": [
            {
                "title": "AIOrchestrator Core Engine",
                "description": "Serviço central que recebe chamadas padronizadas (roles user/assistant + system_prompt separado) e converte para formato específico de cada provider. Inclui chain fallback, provider skip em caso de erro, e resolução de modelo por usage_type.",
                "priority": "critical", "story_points": 13, "status": "done",
                "tasks": [
                    {"title": "Implementar classe AIOrchestrator base", "description": "Classe principal com __init__(db), execute(), e _resolve_model(). Padrão Singleton por sessão. Inicializa cache, rate limiter, e provider adapters.", "sp": 3, "status": "done"},
                    {"title": "Adapter Anthropic (Claude)", "description": "Conversão: system_prompt vai como parâmetro 'system' separado. Roles aceitos: user, assistant. Modelos: Claude Sonnet 4.5, Opus 4.5, Haiku 4. SDK: anthropic.Anthropic().", "sp": 3, "status": "done"},
                    {"title": "Adapter OpenAI (GPT)", "description": "Conversão: system_prompt como primeira mensagem com role='system'. Roles aceitos: system, user, assistant. Modelos: GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo. SDK: openai.OpenAI().", "sp": 3, "status": "done"},
                    {"title": "Adapter Google (Gemini)", "description": "Conversão: system_prompt como system_instruction text. Role 'assistant' -> 'model'. Modelos: Gemini 1.5 Pro, 2.0 Flash, 1.5 Flash. SDK: google.generativeai.", "sp": 2, "status": "done"},
                    {"title": "Adapter Ollama (Local)", "description": "Conversão: system_prompt como mensagem role='system'. Usado para embeddings (Nomic) e modelos locais. Endpoint: 172.27.144.1:11434. HTTP direto.", "sp": 2, "status": "done"},
                ]
            },
            {
                "title": "Chain Fallback & Error Recovery",
                "description": "Sistema de fallback em cadeia: se provider falha, tenta próximo. Rate limiting com sliding window por modelo. GPU OOM detection com skip automático. Backoff exponencial por provider.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Implementar chain fallback resolution", "description": "Ordem: usage_type específico -> 'general' fallback -> choose_model() auto. _skip_providers set para providers com erro. Retry com next provider.", "sp": 3, "status": "done"},
                    {"title": "Rate limiter sliding window", "description": "Sliding window por model_id em Redis. Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 60s. HTTP 429 trigger. Stats em /api/v1/cache/stats.", "sp": 3, "status": "done"},
                    {"title": "GPU OOM detection e provider skip", "description": "Detecção de erros de memória GPU. Provider adicionado a _skip_providers. Fallback imediato para cloud provider. Log de warning.", "sp": 2, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 2: Cache Redis Multi-Nível
    # ============================================================
    {
        "type": "epic", "title": "Cache Redis Multi-Nível (L1/L2/L3)",
        "description": "Sistema de cache em 3 níveis para chamadas de IA: L1 Exact Match (SHA256, 7d), L2 Semantic Match (>95% similaridade, 1d), L3 Template Cache (temperature=0, 30d). Economia esperada: 30-35% de todas as chamadas.",
        "priority": "high", "story_points": 13, "status": "done",
        "stories": [
            {
                "title": "Implementação dos 3 Níveis de Cache",
                "description": "CacheService com lookup chain L1->L2->L3. Redis como backend principal, in-memory fallback para L1. Normalização de temperature para 2 decimais. Cache key inclui model_id + messages hash + system_prompt hash.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "L1 - Exact Match Cache", "description": "SHA256 hash de (model_id + messages + system_prompt + temperature). TTL 7 dias. Hit rate esperado ~20%. Redis key: cache:exact:{hash}.", "sp": 2, "status": "done"},
                    {"title": "L2 - Semantic Match Cache", "description": "Embedding da query, busca em cache entries com similaridade >0.95. TTL 1 dia. Hit rate ~10%. Requer Redis + pgvector. Mais lento que L1.", "sp": 3, "status": "done"},
                    {"title": "L3 - Template Cache", "description": "Apenas para temperature=0 (determinístico). TTL 30 dias. Hit rate ~5%. Ideal para prompts de commit e formatação.", "sp": 2, "status": "done"},
                    {"title": "Cache stats e monitoring", "description": "Endpoint /api/v1/cache/stats com hit rate por nível, total savings em tokens/USD, Redis memory usage. Integrado com dashboard /analytics/tokens.", "sp": 1, "status": "done"},
                ]
            },
            {
                "title": "Redis Connection e Fallback",
                "description": "Gerenciamento de conexão Redis com fallback automático para in-memory quando Redis indisponível. Health check periódico.",
                "priority": "medium", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Redis connection manager", "description": "Conexão Redis via REDIS_HOST/REDIS_PORT do .env. Auto-reconnect em caso de perda. Health check a cada 60s.", "sp": 2, "status": "done"},
                    {"title": "In-memory fallback", "description": "Quando Redis indisponível: L1 funciona com dict in-memory (LRU, max 1000 entries). L2/L3 desabilitados. Log de warning.", "sp": 2, "status": "done"},
                    {"title": "Cache invalidation", "description": "Invalidação por: TTL expirado, model change (novo modelo invalida cache), manual flush via API.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 3: RAG Pipeline com pgvector
    # ============================================================
    {
        "type": "epic", "title": "RAG Pipeline com pgvector",
        "description": "Pipeline completo de Retrieval-Augmented Generation usando PostgreSQL pgvector para busca semântica. Nomic Embed Text 768d. Suporta documentos, código, regras de negócio, respostas de entrevista. Thresholds configuráveis por contexto.",
        "priority": "critical", "story_points": 21, "status": "done",
        "stories": [
            {
                "title": "RAG Foundation (Store/Retrieve/Search)",
                "description": "RAGService core: store() para indexar documentos com embedding, retrieve() para busca por ID, search() para busca semântica com top_k e threshold configuráveis. Cosine distance via pgvector.",
                "priority": "critical", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Configurar pgvector no PostgreSQL", "description": "Extension CREATE EXTENSION vector. Tabela rag_documents com coluna embedding vector(768). Índice IVFFlat para performance.", "sp": 2, "status": "done"},
                    {"title": "RAGService.store()", "description": "Recebe content + metadata, gera embedding via Nomic (30s timeout), insere no rag_documents. Chunking automático para textos > 1500 chars.", "sp": 3, "status": "done"},
                    {"title": "RAGService.search()", "description": "Busca semântica: embedding da query, cosine distance (1 - similarity), filter por project_id e metadata. Thresholds: 0.85 cards, 0.7 search, 0.6 interview, 0.5 rules.", "sp": 3, "status": "done"},
                ]
            },
            {
                "title": "Knowledge Base Management",
                "description": "CRUD completo para documentos, regras de negócio, e arquivos de código no RAG. Upload via API com chunking automático. Busca por filename, category, source.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Upload e indexação de documentos", "description": "POST /knowledge/upload aceita arquivos .md, .txt, .pdf. Chunking por header/parágrafo. Max 1500 chars/chunk, 200 overlap. Metadata: type=document.", "sp": 2, "status": "done"},
                    {"title": "CRUD de regras de negócio", "description": "POST/GET/DELETE /knowledge/rules. Categorias: validation, workflow, calculation, permission, integration. Cada regra indexada com embedding.", "sp": 2, "status": "done"},
                    {"title": "Indexação de código fonte", "description": "POST /index-code escaneia code_path, chunka por classe/função (800 chars, 100 overlap). Metadata: type=code_file, language, domain, layer.", "sp": 2, "status": "done"},
                    {"title": "Stats e monitoring do RAG", "description": "GET /knowledge/stats, /knowledge/full-stats, /knowledge/global-stats. Contagem por tipo, categoria, source. Tabela comparativa por projeto.", "sp": 2, "status": "done"},
                ]
            },
            {
                "title": "Continuous RAG Evolution Pipeline",
                "description": "Pipeline de 4 fases para evolução contínua: Scan (detectar arquivos novos/modificados) -> Extract Rules -> Generate Cards -> Generate Wiki. File state machine: pending->scanned->indexed->enriched.",
                "priority": "high", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "File Scanner com state machine", "description": "Detecta arquivos novos/modificados em code_path. Respeita .gitignore e IGNORE_DIRECTORIES. State transitions: pending->scanned->indexed->enriched. Re-scan em modified_at change.", "sp": 2, "status": "done"},
                    {"title": "Rule Extraction automatizada", "description": "Extrai regras de negócio de código analisado. Classifica por categoria. Evita duplicatas via similaridade >0.85.", "sp": 2, "status": "done"},
                    {"title": "Pipeline reset e re-indexação", "description": "DELETE /rag/reset limpa RAG docs do projeto. Re-indexa do zero. Preserva regras manuais (source='manual').", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 4: Sistema de Entrevistas Contextuais
    # ============================================================
    {
        "type": "epic", "title": "Sistema de Entrevistas Contextuais",
        "description": "Sistema de 3 fases para descoberta de projeto via entrevistas interativas. Phase 1: perguntas fixas de stack. Phase 2: perguntas dinâmicas de IA baseadas em contexto. Phase 3: perguntas focadas em card/tarefa específica.",
        "priority": "high", "story_points": 13, "status": "done",
        "stories": [
            {
                "title": "Engine de Entrevistas (3 Fases)",
                "description": "InterviewService com state machine de fases. Phase 1 determinístico, Phase 2 usa AI (Claude Haiku), Phase 3 contextual por card. Respostas armazenadas no RAG para contexto futuro.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Phase 1: Fixed Stack Questions", "description": "Perguntas predefinidas: framework, banco de dados, linguagem, deployment. Opções fechadas. Sem AI. Resultado alimenta stack detection.", "sp": 2, "status": "done"},
                    {"title": "Phase 2: Dynamic AI Questions", "description": "Claude Haiku gera perguntas contextuais baseadas em respostas anteriores. Formato: closed-ended com 3-5 opções. Validação de não-redundância via RAG (threshold 0.8).", "sp": 3, "status": "done"},
                    {"title": "Phase 3: Task-Focused Questions", "description": "Perguntas específicas ao criar card: requisitos, acceptance criteria, dependências. Contexto do Epic/Story pai injetado.", "sp": 2, "status": "done"},
                    {"title": "Interview answer storage no RAG", "description": "Cada resposta indexada com: type=interview_answer, question_text, answer_text, category, session_id. Embedding gerado para busca futura.", "sp": 1, "status": "done"},
                ]
            },
            {
                "title": "Geração de Backlog a partir de Entrevistas",
                "description": "Conversão automática de respostas de entrevista em hierarquia de cards. Semantic Reference Methodology (N1/P1/E1/AC1) para rastreabilidade.",
                "priority": "high", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Epic generation from interview", "description": "BacklogGenerator recebe conversation_text, gera Epics com description_markdown contendo referências semânticas (N1, P1, E1).", "sp": 2, "status": "done"},
                    {"title": "Story decomposition", "description": "Cada Epic decomposto em Stories. Herança do semantic map do Epic pai. Stories adicionam próprios AC (AC1-ACn).", "sp": 2, "status": "done"},
                    {"title": "Task decomposition", "description": "Cada Story decomposta em Tasks. Story points Fibonacci (1,2,3,5). Dual description: markdown (semântico) + plain (legível). Dedup via RAG >0.90.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 5: Deep Pipeline (7 Fases)
    # ============================================================
    {
        "type": "epic", "title": "Deep Pipeline de Análise de Codebase",
        "description": "Motor de 7 fases para análise profunda de codebase: Phase 0 Structural Scan, Phase 1 File Analysis (Haiku 10x parallel), Phase 2 Rule Synthesis (Sonnet 5x), Phase 3 Architectural Map, Phase 4 Card Generation (Opus), Phase 5 Wiki Generation (Opus), Phase 6-7 QA & Gap Filling.",
        "priority": "high", "story_points": 21, "status": "done",
        "stories": [
            {
                "title": "Phases 0-2: Analysis Engine",
                "description": "Scan estrutural de todos os arquivos, análise por arquivo com AI, e síntese cross-file de regras de negócio. Model allocation: Phase 0 sem AI, Phase 1 Haiku, Phase 2 Sonnet.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Phase 0: Structural Scan", "description": "Inventário de arquivos, detecção de linguagem, classificação por layer (migration, model, route, service, test, ui, config, infrastructure, prompt_template, schema). Sem AI.", "sp": 2, "status": "done"},
                    {"title": "Phase 1: Per-File Analysis", "description": "Claude Haiku analisa cada arquivo: extrai classes, funções, imports, patterns. 10 workers paralelos. Chunks de 800 chars. Metadata: domain, layer, dependencies.", "sp": 3, "status": "done"},
                    {"title": "Phase 2: Cross-File Rule Synthesis", "description": "Claude Sonnet sintetiza regras de negócio de análises individuais. 5 workers paralelos por domínio. Agrupa por categoria: validation, workflow, calculation, integration.", "sp": 3, "status": "done"},
                ]
            },
            {
                "title": "Phases 3-5: Generation Engine",
                "description": "Construção de mapa arquitetural, geração hierárquica de cards, e criação de wiki rica. Models: Sonnet para arch, Opus para cards e wiki.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Phase 3: Architectural Map", "description": "Mapa de domínios com dependências, patterns, cross-domain flows. Stored em project.context_semantic como JSON estruturado.", "sp": 2, "status": "done"},
                    {"title": "Phase 4: Card Generation", "description": "Claude Opus gera Epics por domínio, Stories por feature, Tasks por implementação. Dual description, semantic references, Fibonacci points. Dedup via RAG.", "sp": 3, "status": "done"},
                    {"title": "Phase 5: Wiki Generation", "description": "Claude Opus gera 24+ wiki pages: overview, domain pages (17), architecture, flows, conventions, API docs. YAML front matter + Markdown. Dual persistence DB+FS.", "sp": 3, "status": "done"},
                ]
            },
            {
                "title": "Phases 6-7: Quality Assurance",
                "description": "Scoring de qualidade por fase (0-100) e gap filling para fases com score <70. Reinforcement learning entre runs.",
                "priority": "medium", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Phase 6: Quality Scoring", "description": "Score por fase: completeness (40%), depth (30%), consistency (20%), novelty (10%). Threshold: 70. Fases abaixo trigger Phase 7.", "sp": 2, "status": "done"},
                    {"title": "Phase 7: Gap Filling", "description": "Reinforcement: re-executa fases com score <70 com prompts mais detalhados. Máximo 2 iterações por fase. Log de melhorias.", "sp": 2, "status": "done"},
                    {"title": "Pipeline run tracking", "description": "Cada execução cria DeepPipelineRun com: run_id, profile_id, phase_results JSON, total_score, metrics. Endpoint /deep-pipeline/compare para comparar 2 runs.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 6: Wiki Automática
    # ============================================================
    {
        "type": "epic", "title": "Sistema de Wiki Automática",
        "description": "Wiki com geração automática via AI, 4 operações (Generate/Expand/Summarize/Rephrase), dual persistence (DB + filesystem), REGRA #0 protection, e semantic relinking entre páginas.",
        "priority": "high", "story_points": 13, "status": "done",
        "stories": [
            {
                "title": "Wiki Core: Storage e CRUD",
                "description": "Dual persistence em wiki_pages table (PostgreSQL) e satellite/knowledge/wiki/*.md (filesystem). YAML front matter com title, slug, source, order_index. UUID5 determinístico.",
                "priority": "high", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "WikiFS: filesystem storage", "description": "Salva pages em satellite/knowledge/wiki/{slug}.md. YAML front matter: title, slug, source, order_index, created_at, updated_at. Body em Markdown.", "sp": 2, "status": "done"},
                    {"title": "Wiki CRUD API", "description": "GET/POST/PUT/DELETE /wiki/pages. List com filtering por source. Single page por slug. Sync automático DB<->FS em write.", "sp": 2, "status": "done"},
                    {"title": "REGRA #0 Protection", "description": "Pages com source='manual' ou 'enrichment' NUNCA sobrescritas por geração automática. Guard check em wiki_service antes de qualquer update.", "sp": 1, "status": "done"},
                ]
            },
            {
                "title": "Wiki AI Operations",
                "description": "Quatro operações de IA em conteúdo wiki: Generate (criar do zero via RAG context), Expand (detalhar seção), Summarize (condensar), Rephrase (reescrever tom/clareza).",
                "priority": "medium", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Generate from context", "description": "POST /wiki/generate-from-context. Busca RAG context relevante, gera páginas via AI. Batch generation para múltiplas páginas.", "sp": 2, "status": "done"},
                    {"title": "Expand operation", "description": "Recebe page slug + section. AI expande com mais detalhes, exemplos, e referências do RAG.", "sp": 2, "status": "done"},
                    {"title": "Summarize operation", "description": "Condensa conteúdo longo mantendo pontos-chave. Preserva referências semânticas.", "sp": 1, "status": "done"},
                    {"title": "Rephrase operation", "description": "Reescreve para tom diferente (técnico, executivo, onboarding). Mantém informações, muda estilo.", "sp": 1, "status": "done"},
                    {"title": "Rule enrichment e semantic relinking", "description": "Enriquece pages com regras de negócio relevantes. Cria links semânticos entre pages relacionadas baseado em similaridade de embedding.", "sp": 2, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 7: Backlog Generator
    # ============================================================
    {
        "type": "epic", "title": "Geração Hierárquica de Backlog",
        "description": "Sistema de geração de backlog com hierarquia Epic->Story->Task, Semantic Reference Methodology (N1/P1/E1/AC1), dual description format, modification detection, e integração com RAG para deduplicação.",
        "priority": "high", "story_points": 13, "status": "done",
        "stories": [
            {
                "title": "BacklogGenerator Core",
                "description": "Serviço principal que orquestra geração de Epics, decomposição em Stories, e decomposição em Tasks. Usa prompts YAML externalizados. Integra com RAG para dedup.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Epic generation engine", "description": "Recebe context (interview answers, RAG docs). Gera Epics com semantic references (N1-Nn, P1-Pn). description_markdown + description plain.", "sp": 3, "status": "done"},
                    {"title": "Story decomposition engine", "description": "Recebe Epic + context. Herda semantic map. Decompõe em Stories com acceptance criteria (AC1-ACn). Fibonacci story points.", "sp": 3, "status": "done"},
                    {"title": "Task decomposition engine", "description": "Recebe Story + context. Gera Tasks implementáveis. Points 1-5. Cada Task tem: título, description_markdown, description, acceptance criteria.", "sp": 2, "status": "done"},
                ]
            },
            {
                "title": "Deduplicação e Qualidade",
                "description": "Detecção de modificação via similaridade coseno >90% para evitar cards duplicados. Validação de Fibonacci. Preservação de cards editados manualmente.",
                "priority": "medium", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Modification detection (>90% similarity)", "description": "RAGService.find_similar_cards() antes de criar. Se >0.90, retorna existente. Bloqueia criação duplicada.", "sp": 2, "status": "done"},
                    {"title": "Story points Fibonacci validation", "description": "Apenas valores 1,2,3,5,8,13,21 aceitos. Epics: 8-21, Stories: 3-13, Tasks: 1-5. Validação no schema Pydantic.", "sp": 1, "status": "done"},
                    {"title": "REGRA #0 para cards", "description": "Cards com descrição editada manualmente (description != ai_original) não são sobrescritos por regeneração. Campo ai_generated para tracking.", "sp": 2, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 8: Prompt Management System
    # ============================================================
    {
        "type": "epic", "title": "Sistema de Prompts Externalizados",
        "description": "76 prompts YAML externalizados em backend/app/prompts/ com Jinja2 templating. PromptLoader carrega, renderiza, e injeta componentes reutilizáveis. Categorias: backlog, commits, components, context, discovery, interviews.",
        "priority": "high", "story_points": 13, "status": "done",
        "stories": [
            {
                "title": "PromptLoader e YAML Schema",
                "description": "PromptLoader: carrega YAML, valida schema (name, version, category, variables, system_prompt, user_prompt), renderiza Jinja2, injeta components. Retorna tuple (system_prompt, user_prompt).",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "PromptLoader core", "description": "Carrega YAML de backend/app/prompts/{category}/{name}.yaml. Valida required fields. Renderiza Jinja2 com variáveis. Retorna (system, user).", "sp": 3, "status": "done"},
                    {"title": "Component injection system", "description": "Components em prompts/components/*.yaml (ex: semantic_methodology). Injetados via {{ components.name }}. Reutilizáveis entre prompts.", "sp": 2, "status": "done"},
                    {"title": "Prompt catalog e discovery", "description": "76 YAML files organizados: backlog/ (12), commits/ (3), components/ (5), context/ (8), discovery/ (6), interviews/ (42). Tags para busca.", "sp": 2, "status": "done"},
                    {"title": "Migração de hardcoded para YAML", "description": "Identificação e migração de prompts hardcoded em código Python para YAML. Zero hardcoded prompts restantes.", "sp": 1, "status": "done"},
                ]
            },
            {
                "title": "Prompt Versioning e Sections",
                "description": "Versionamento de prompts (campo version), seções especializadas para interviews (business, design, mobile), e prompts por tipo de task.",
                "priority": "medium", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Interview section prompts", "description": "Prompts especializados em interviews/sections/: business_analysis, design_system, mobile_specific, performance, security.", "sp": 2, "status": "done"},
                    {"title": "Card-focused prompts", "description": "Prompts em interviews/card_focused/: epic_questions, story_questions, task_questions. Contextuais ao tipo de card.", "sp": 2, "status": "done"},
                    {"title": "Prompt versioning", "description": "Campo version (integer) em cada YAML. PromptLoader carrega versão mais recente. Backward compatible.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 9: Frontend Next.js 14 App Router
    # ============================================================
    {
        "type": "epic", "title": "Frontend Next.js 14 App Router",
        "description": "Interface web em Next.js 14 com App Router, React 18, TypeScript, Tailwind CSS. Páginas: projetos, Kanban board, interview, analytics (tokens/custos), AI Studio, jobs, settings, wiki.",
        "priority": "high", "story_points": 21, "status": "done",
        "stories": [
            {
                "title": "Páginas de Projeto",
                "description": "Lista de projetos (home), detalhes do projeto com tabs, Kanban board com drag-and-drop, e criação de projeto com interview flow.",
                "priority": "high", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Lista de projetos (home page)", "description": "Grid de project cards com nome, stack, status, card count. Busca e filtros. Link para detalhes.", "sp": 2, "status": "done"},
                    {"title": "Detalhes do projeto", "description": "/projects/[id]: tabs para overview, board, interview, wiki, knowledge, settings. Breadcrumbs. Metadata display.", "sp": 3, "status": "done"},
                    {"title": "Kanban board", "description": "/projects/[id]/board: colunas backlog/todo/in_progress/review/done. Drag-and-drop status update. Filter por type/priority.", "sp": 3, "status": "done"},
                ]
            },
            {
                "title": "Analytics (Tokens & Custos)",
                "description": "Dashboard de uso de tokens e custos por período, modelo, usage_type. Gráficos com Recharts. Métricas RAG. Conversão BRL via AwesomeAPI.",
                "priority": "high", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Tokens & Performance page", "description": "/analytics/tokens: cards com total tokens, chamadas, cache hit rate. Gráficos de uso por período. Tabela por modelo. Métricas RAG.", "sp": 3, "status": "done"},
                    {"title": "Costs page", "description": "/analytics/costs: custo total USD/BRL, breakdown por provider, por usage_type. Exchange rate real-time via AwesomeAPI. Projeção mensal.", "sp": 2, "status": "done"},
                ]
            },
            {
                "title": "AI Studio (AI Flow)",
                "description": "Interface para execução e monitoramento de Deep Pipeline. Pipeline profiles, execution panel, run history e comparison side-by-side.",
                "priority": "medium", "story_points": 8, "status": "done",
                "tasks": [
                    {"title": "Pipeline Profiles management", "description": "CRUD de profiles: nome, per-phase model selection, max_tokens, concurrency, quality_threshold. Set default.", "sp": 3, "status": "done"},
                    {"title": "Execution panel", "description": "Select project + profile, start pipeline, real-time progress (phase, percentage, current file). Stop button.", "sp": 3, "status": "done"},
                    {"title": "Run history e comparison", "description": "Lista de runs com: date, profile, score, duration, metrics. Compare 2 runs side-by-side: delta scores, new findings.", "sp": 2, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 10: Framework Specs & Token Reduction
    # ============================================================
    {
        "type": "epic", "title": "Framework Specs e Token Reduction",
        "description": "47 especificações de frameworks (Laravel, Next.js, PostgreSQL, Tailwind, etc.) no banco. Injetadas em prompts baseado no stack do projeto. Redução de 70-85% no uso de tokens substituindo instruções verbose por specs concisas.",
        "priority": "high", "story_points": 8, "status": "done",
        "stories": [
            {
                "title": "Spec Database e Selective Loading",
                "description": "Tabela framework_specs com 47 specs seeded. SpecService carrega apenas specs do stack do projeto. Cache em Redis por projeto.",
                "priority": "high", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Framework specs table e seed", "description": "Tabela framework_specs: name, category, content, version. 47 specs seeded: Laravel, Next.js, React, PostgreSQL, Tailwind, etc.", "sp": 2, "status": "done"},
                    {"title": "SpecService selective loading", "description": "Carrega specs baseado em project.stack. Match por nome de framework. Cache Redis per-project (TTL 1h).", "sp": 2, "status": "done"},
                    {"title": "Token reduction integration", "description": "Specs injetadas em prompts de backlog generation (60-80% reduction) e task execution (15-20% adicional). Total: 70-85%.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 11: Job System & Background Processing
    # ============================================================
    {
        "type": "epic", "title": "Sistema de Jobs Assíncronos",
        "description": "PriorityJobExecutor para processamento em background. 4 níveis de prioridade (P0-P3). Job tracking com status real-time. NotificationBell no frontend. Job types: deep_pipeline, backlog, wiki, code_indexing, rag_scan.",
        "priority": "medium", "story_points": 8, "status": "done",
        "stories": [
            {
                "title": "Job Executor e Tracking",
                "description": "PriorityJobExecutor com queue por prioridade. Job lifecycle: queued->running->completed|failed|cancelled. Progress tracking real-time. API para list/cancel jobs.",
                "priority": "medium", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "PriorityJobExecutor", "description": "Queue com 4 prioridades: critical (P0), high (P1), medium (P2), low (P3). Worker thread pool. Concurrency limits per priority.", "sp": 2, "status": "done"},
                    {"title": "Job tracking API", "description": "GET /jobs/active, GET /jobs/history, POST /jobs/{id}/cancel. Progress percentage, current phase, estimated time.", "sp": 2, "status": "done"},
                    {"title": "NotificationBell component", "description": "Frontend component que poll /jobs/active a cada 5s. Badge com count de jobs ativos. Dropdown com lista. Click para ver detalhes.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 12: Git Integration
    # ============================================================
    {
        "type": "epic", "title": "Integração Git e Commit Generation",
        "description": "Serviço de integração Git para operações de repositório e geração de mensagens de commit via AI. Conventional Commits format. Default model: Gemini 1.5 Pro.",
        "priority": "medium", "story_points": 5, "status": "done",
        "stories": [
            {
                "title": "Git Service e Commit AI",
                "description": "GitService wraps git CLI para operações (status, diff, log, commit, push). Commit message generation usa diff + file list + recent history para contexto.",
                "priority": "medium", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "GitService core", "description": "Wrapper git CLI: status(), diff(), log(), commit(), push(). Detecta git info (remote URL, branch, last commit). Stored em project.git_info.", "sp": 2, "status": "done"},
                    {"title": "AI commit message generation", "description": "Recebe git diff, gera message Conventional Commits (feat/fix/docs/refactor/test/chore/perf). Footer: Co-Authored-By. Model: Gemini 1.5 Pro.", "sp": 2, "status": "done"},
                    {"title": "Git info display", "description": "Frontend mostra: repo URL, branch, last commit, status. Link para GitHub.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 13: Pattern Discovery & Tech Stack Detection
    # ============================================================
    {
        "type": "epic", "title": "Pattern Discovery e Tech Stack Detection",
        "description": "Detecção automática de padrões arquiteturais e stack tecnológica do projeto via análise de código. Identificação de frameworks, bibliotecas, patterns de design, e convenções.",
        "priority": "medium", "story_points": 8, "status": "done",
        "stories": [
            {
                "title": "Tech Stack Detector",
                "description": "Análise de package.json, requirements.txt, Dockerfile, imports para detectar stack. Confidence score por detecção. Resultado salvo em project.stack.",
                "priority": "medium", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "File-based stack detection", "description": "Analisa: package.json (frontend), requirements.txt/pyproject.toml (backend), docker-compose (infra). Extrai frameworks e versões.", "sp": 2, "status": "done"},
                    {"title": "Import-based pattern detection", "description": "Analisa imports em .py e .ts/.tsx para detectar patterns: Repository, Service Layer, MVC, Event-driven. Confidence score.", "sp": 2, "status": "done"},
                    {"title": "AI-assisted pattern discovery", "description": "AI analisa code samples para identificar patterns não-óbvios: CQRS, Event Sourcing, Saga. Usado no Deep Pipeline Phase 2.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
    # ============================================================
    # EPIC 14: Project Management Core
    # ============================================================
    {
        "type": "epic", "title": "Gestão de Projetos Core",
        "description": "CRUD de projetos com criação automatizada (create-and-process), satellite directory setup, metadata management (stack, git_info, context), e integração com todas as features.",
        "priority": "high", "story_points": 8, "status": "done",
        "stories": [
            {
                "title": "Project CRUD e Satellite Setup",
                "description": "API completa de projetos. POST /create-and-process cria projeto + satellite dirs + inicia scan. Metadata: stack, git_info, context_semantic, context_human, description.",
                "priority": "high", "story_points": 5, "status": "done",
                "tasks": [
                    {"title": "Project CRUD API", "description": "POST/GET/PUT/DELETE /projects. Create-and-process: cria projeto, satellite dirs, inicia initial scan. List com pagination.", "sp": 2, "status": "done"},
                    {"title": "Satellite directory creation", "description": "Cria em code_path: satellite/ com subdirs memory/, docs/, knowledge/, knowledge/wiki/, knowledge/results/, knowledge/prompts/. Auto no create.", "sp": 1, "status": "done"},
                    {"title": "Project metadata management", "description": "Campos: name, description, code_path, stack, git_info (JSON), status (active/archived), context_semantic (JSON), context_human (text).", "sp": 2, "status": "done"},
                ]
            },
            {
                "title": "AI Models Management",
                "description": "CRUD de modelos de IA com API keys no banco. Página /ai-models para configuração. Usage type routing (interview->Haiku, generation->GPT-4o, etc.).",
                "priority": "high", "story_points": 3, "status": "done",
                "tasks": [
                    {"title": "AI Models CRUD", "description": "Tabela ai_models: name, provider, model_id, api_key, usage_types[], is_active. CRUD API + frontend /ai-models page.", "sp": 2, "status": "done"},
                    {"title": "Usage type routing", "description": "Cada modelo tem usage_types (interview, task_execution, prompt_generation, commit_generation, general). AIOrchestrator seleciona baseado em usage_type.", "sp": 1, "status": "done"},
                ]
            },
        ]
    },
]

def create_card(cur, card_type, title, description, priority, story_points, status, parent_id=None, order=0):
    card_id = str(uuid.uuid4())
    embedding = get_embedding(f"{title}\n{description}")
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    # Map status to column
    column_map = {"done": "done", "backlog": "backlog", "in_progress": "in_progress", "todo": "todo"}
    column = column_map.get(status, "backlog")

    # Insert task (card)
    cur.execute("""
        INSERT INTO tasks (id, project_id, title, description, type, status, priority, story_points, parent_id, "order", "column", item_type, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
    """, (card_id, PROJECT_ID, title, description, card_type, status, priority, story_points, parent_id, order, column, card_type))

    # Index in RAG
    rag_id = str(uuid.uuid4())
    content = f"{card_type.upper()}: {title}\n\nPriority: {priority}\nStory Points: {story_points}\nStatus: {status}\n\n{description}"
    metadata = json.dumps({
        "type": "card",
        "card_type": card_type,
        "card_id": card_id,
        "source": "deep_pipeline_phase4",
        "priority": priority
    })

    cur.execute("""
        INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at)
        VALUES (%s, %s, %s, %s::vector, %s::jsonb, NOW())
    """, (rag_id, PROJECT_ID, content, embedding_str, metadata))

    return card_id

def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # Clear existing cards
    cur.execute("DELETE FROM tasks WHERE project_id = %s", (PROJECT_ID,))
    print(f"Cleared {cur.rowcount} existing cards")

    # Clear old card RAG docs
    cur.execute("DELETE FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'card'", (PROJECT_ID,))
    print(f"Cleared {cur.rowcount} old card RAG docs")

    epic_count = 0
    story_count = 0
    task_count = 0
    total_sp = 0

    for epic_data in HIERARCHY:
        epic_count += 1
        print(f"\n[Epic {epic_count}] {epic_data['title']} ({epic_data['story_points']} SP)")
        epic_id = create_card(
            cur, "epic", epic_data["title"], epic_data["description"],
            epic_data["priority"], epic_data["story_points"], epic_data["status"],
            order=epic_count
        )
        total_sp += epic_data["story_points"]

        for si, story_data in enumerate(epic_data.get("stories", [])):
            story_count += 1
            print(f"  [Story] {story_data['title']} ({story_data['story_points']} SP)")
            story_id = create_card(
                cur, "story", story_data["title"], story_data["description"],
                story_data["priority"], story_data["story_points"], story_data["status"],
                parent_id=epic_id, order=si+1
            )

            for ti, task_data in enumerate(story_data.get("tasks", [])):
                task_count += 1
                sp = task_data.get("sp", 2)
                create_card(
                    cur, "task", task_data["title"], task_data["description"],
                    "medium", sp, task_data.get("status", "done"),
                    parent_id=story_id, order=ti+1
                )

    conn.commit()
    print(f"\n{'='*60}")
    print(f"Phase 4 Complete!")
    print(f"  Epics:   {epic_count}")
    print(f"  Stories: {story_count}")
    print(f"  Tasks:   {task_count}")
    print(f"  Total:   {epic_count + story_count + task_count}")
    print(f"  Total SP: {total_sp}")

    # Verify
    cur.execute("SELECT type, COUNT(*) FROM tasks WHERE project_id = %s GROUP BY type ORDER BY type", (PROJECT_ID,))
    print("\nCards by type:")
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
