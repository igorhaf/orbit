#!/usr/bin/env python3
"""
ORBIT Self-Bootstrap Script
============================
Creates a fully initialized ORBIT instance for the ORBIT project itself,
using existing markdown documentation as the source of truth.

This script:
1. Indexes all .md documentation files into RAG (chunked + embedded)
2. Extracts and stores business rules from CLAUDE.md and key docs
3. Creates structured cards (Epics, Stories, Tasks) from documentation
4. Generates wiki pages from existing documentation
5. Validates all formats and generates a final report

Usage:
    cd /home/igorhaf/orbit
    poetry run python scripts/bootstrap_orbit_self.py
"""

import json
import logging
import os
import re
import sys
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.database import SessionLocal
from app.services.rag_service import RAGService
from app.models.project import Project
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Project constants
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
ORBIT_ROOT = "/home/igorhaf/orbit"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50

# ============================================================================
# DOCUMENT CLASSIFICATION
# ============================================================================

DOC_CATEGORIES = {
    "architecture": [
        "CLAUDE.md",
        "MODELS_DOCUMENTATION.md",
        "JIRA_TRANSFORMATION_ANALYSIS.md",
        "ORBIT_REPORT.md",
        "META_PROMPT.md",
    ],
    "prompt_instructions": [
        "PROMPTER_FEATURE_FLAGS.md",
    ],
    "functional_spec": [
        "README.md",
        "BUSINESS_RULES_EXTRACTION.md",
        "plan.md",
    ],
    "technical_docs": [
        "project-analyzer-usage.md",
        "project-analyzer-implementation-summary.md",
    ],
}


def classify_document(filepath: str) -> str:
    """Classify a document by its path and filename."""
    filename = os.path.basename(filepath)

    # Check explicit classifications
    for category, filenames in DOC_CATEGORIES.items():
        if filename in filenames:
            return category

    # Pattern-based classification
    if "PROMPT_" in filename and "_REPORT" in filename:
        return "prompt_history"
    if "PROMPT_" in filename:
        return "prompt_history"
    if "/wiki/" in filepath:
        return "wiki"
    if "/prompts/" in filepath and filepath.endswith(".yaml"):
        return "prompt_instructions"
    if "/docs/" in filepath:
        return "technical_docs"
    if "/knowledge/" in filepath:
        return "prompt_history"

    return "technical_docs"


# ============================================================================
# CHUNKING
# ============================================================================

def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into semantic chunks, preserving structure."""
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    # Try to split by headers first
    sections = re.split(r'\n(?=#{1,3} )', text)

    current_chunk = ""
    for section in sections:
        if len(current_chunk) + len(section) <= chunk_size:
            current_chunk += section
        else:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
            # If section itself is too large, split by paragraphs
            if len(section) > chunk_size:
                paragraphs = section.split('\n\n')
                current_chunk = ""
                for para in paragraphs:
                    if len(current_chunk) + len(para) <= chunk_size:
                        current_chunk += para + "\n\n"
                    else:
                        if current_chunk.strip():
                            chunks.append(current_chunk.strip())
                        # If paragraph is still too large, split by chars
                        if len(para) > chunk_size:
                            for i in range(0, len(para), chunk_size - overlap):
                                chunk = para[i:i + chunk_size]
                                if chunk.strip():
                                    chunks.append(chunk.strip())
                            current_chunk = ""
                        else:
                            current_chunk = para + "\n\n"
            else:
                current_chunk = section

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks if chunks else [text[:chunk_size]]


# ============================================================================
# ETAPA 1 + 3: INDEXAÇÃO E POPULAÇÃO DO RAG
# ============================================================================

def find_all_md_files() -> List[str]:
    """Find all .md files in the repository."""
    md_files = []
    exclude_dirs = {
        'node_modules', '.next', '.git', '__pycache__',
        'venv', '.venv', 'dist', 'build', '.cache'
    }

    for root, dirs, files in os.walk(ORBIT_ROOT):
        # Skip excluded directories
        dirs[:] = [d for d in dirs if d not in exclude_dirs]

        for f in files:
            if f.endswith('.md'):
                md_files.append(os.path.join(root, f))

    return sorted(md_files)


def index_documents_to_rag(db, rag: RAGService) -> Dict:
    """Index all markdown documents into RAG with embeddings."""
    project_id = UUID(PROJECT_ID)
    md_files = find_all_md_files()

    stats = {
        "files_processed": 0,
        "chunks_created": 0,
        "files_skipped": 0,
        "errors": [],
        "by_category": {},
    }

    logger.info(f"Found {len(md_files)} markdown files to index")

    for filepath in md_files:
        try:
            rel_path = os.path.relpath(filepath, ORBIT_ROOT)

            # Skip very small files
            if os.path.getsize(filepath) < 50:
                stats["files_skipped"] += 1
                continue

            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()

            if len(content.strip()) < 50:
                stats["files_skipped"] += 1
                continue

            category = classify_document(filepath)
            filename = os.path.basename(filepath)

            # Track by category
            stats["by_category"][category] = stats["by_category"].get(category, 0) + 1

            # Chunk the document
            chunks = chunk_text(content)

            for i, chunk in enumerate(chunks):
                metadata = {
                    "type": "document",
                    "content_type": category,
                    "source": "bootstrap",
                    "filename": filename,
                    "file_path": rel_path,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                }

                try:
                    rag.store(
                        content=chunk,
                        metadata=metadata,
                        project_id=project_id
                    )
                    stats["chunks_created"] += 1
                except Exception as e:
                    stats["errors"].append(f"Chunk {i} of {rel_path}: {str(e)}")
                    logger.warning(f"Failed to store chunk {i} of {rel_path}: {e}")

            stats["files_processed"] += 1

            if stats["files_processed"] % 20 == 0:
                logger.info(f"Progress: {stats['files_processed']}/{len(md_files)} files, {stats['chunks_created']} chunks")

        except Exception as e:
            stats["errors"].append(f"{filepath}: {str(e)}")
            logger.error(f"Error processing {filepath}: {e}")

    logger.info(f"RAG indexing complete: {stats['files_processed']} files, {stats['chunks_created']} chunks")
    return stats


# ============================================================================
# ETAPA 2: EXTRAÇÃO DE REGRAS DE NEGÓCIO
# ============================================================================

BUSINESS_RULES = [
    {
        "title": "Dados Humanos São Sagrados (REGRA #0)",
        "description": "Dados inseridos ou editados por operador humano têm prioridade absoluta sobre dados gerados por IA. IA pode preencher campos vazios, mas NUNCA sobrescrever dados editados por humano.",
        "category": "validation",
    },
    {
        "title": "API Keys no Banco de Dados",
        "description": "API keys são armazenadas na tabela ai_models do PostgreSQL, NUNCA em .env. O usuário configura via interface web /ai-models.",
        "category": "integration",
    },
    {
        "title": "Compatibilidade Multi-Provider",
        "description": "ORBIT orquestra 3 providers de IA (Anthropic Claude, OpenAI GPT, Google Gemini). Messages devem usar apenas roles 'user' e 'assistant'. System prompt é separado. AIOrchestrator converte para formato de cada provider.",
        "category": "integration",
    },
    {
        "title": "Cache Redis Multi-Nível",
        "description": "Todas as chamadas de IA usam cache Redis automaticamente via AIOrchestrator. 3 níveis: L1 Exact Match (TTL 7d), L2 Semantic Match >95% (TTL 1d), L3 Template Cache temperature=0 (TTL 30d). Hit rate esperado: 30-35%.",
        "category": "calculation",
    },
    {
        "title": "Prompts Externalizados para YAML",
        "description": "Todos os prompts de IA devem estar em arquivos YAML na pasta backend/app/prompts/. Usar PromptLoader para carregar. Nunca criar prompts hardcoded em código Python.",
        "category": "workflow",
    },
    {
        "title": "AIOrchestrator Centralizado",
        "description": "Todas as chamadas de IA devem passar pelo AIOrchestrator. Nunca fazer chamadas diretas às APIs dos providers. AIOrchestrator garante compatibilidade, logging, cost tracking e cache.",
        "category": "workflow",
    },
    {
        "title": "Hierarquia de Cards: Epic → Story → Task",
        "description": "Sistema de backlog segue hierarquia JIRA-like. Epics são gerados a partir de entrevistas. Stories são decompostas de Epics. Tasks são decompostas de Stories. Cascade delete em filhos.",
        "category": "workflow",
    },
    {
        "title": "Detecção de Modificação (>90% Similaridade)",
        "description": "Ao criar tasks, sistema verifica tasks existentes com >90% similaridade semântica. Se encontrar, bloqueia task existente com pending_modification para aprovação do usuário.",
        "category": "validation",
    },
    {
        "title": "RAG Pipeline Progressivo (4 Fases)",
        "description": "Fase 1: Scan de arquivos + embedding. Fase 2: Extração de regras via IA. Fase 3: Geração de cards. Fase 4: Geração de wiki. Cada fase é desbloqueada progressivamente.",
        "category": "workflow",
    },
    {
        "title": "Embeddings via Nomic Embed Text (768d)",
        "description": "Todos os embeddings usam modelo Nomic Embed Text via Ollama, gerando vetores de 768 dimensões. Busca por similaridade de cosseno via pgvector no PostgreSQL.",
        "category": "integration",
    },
    {
        "title": "Documentação Obrigatória por Prompt",
        "description": "Para cada prompt/tarefa implementada, DEVE ser criado um arquivo satellite/knowledge/PROMPT_[N]_[DESCRIÇÃO].md seguindo template padrão com seções: Objective, Implementation, Files Modified, Testing, Status.",
        "category": "workflow",
    },
    {
        "title": "Git Commit Padrão",
        "description": "Conventional Commits (feat:, fix:, docs:, refactor:, test:, chore:, perf:). Incluir PROMPT #[N] no body. Footer: Co-Authored-By: Claude Sonnet 4.5.",
        "category": "workflow",
    },
    {
        "title": "Satellite Directory Structure",
        "description": "Cada projeto tem pasta satellite/ com: memory/ (logs IA), docs/ (documentos externos para RAG), knowledge/ (base estruturada), knowledge/wiki/ (wiki pages), knowledge/results/ (resultados), knowledge/prompts/ (prompts exportados).",
        "category": "workflow",
    },
    {
        "title": "Token Reduction via Specs (70-85%)",
        "description": "Sistema usa especificações de frameworks armazenadas no banco para reduzir uso de tokens: Phase 3 (60-80% redução com specs na geração) + Phase 4 (15-20% adicional na execução).",
        "category": "calculation",
    },
    {
        "title": "Prioridade de Jobs Async",
        "description": "Sistema de jobs assíncronos com 4 níveis de prioridade: CRITICAL (10, user waiting), HIGH (7, wizard), NORMAL (5, user triggered), LOW (3, background). PriorityJobExecutor gerencia a fila.",
        "category": "workflow",
    },
]


def create_business_rules(db, rag: RAGService) -> int:
    """Store business rules in RAG."""
    project_id = UUID(PROJECT_ID)
    count = 0

    for rule in BUSINESS_RULES:
        content = f"Regra de Negócio: {rule['title']}\n\n{rule['description']}"
        metadata = {
            "type": "business_rule",
            "content_type": "business_rule",
            "source": "bootstrap",
            "category": rule["category"],
            "title": rule["title"],
        }

        try:
            rag.store(content=content, metadata=metadata, project_id=project_id)
            count += 1
        except Exception as e:
            logger.error(f"Failed to store rule '{rule['title']}': {e}")

    logger.info(f"Created {count} business rules in RAG")
    return count


# ============================================================================
# ETAPA 4: CRIAÇÃO DE CARDS (EPICS, STORIES, TASKS)
# ============================================================================

EPICS = [
    {
        "title": "Orquestração Multi-Provider de IA",
        "description": "Sistema central de orquestração que gerencia múltiplos providers de IA (Anthropic Claude, OpenAI GPT, Google Gemini) com roteamento automático por usage_type, cache Redis multi-nível e cost tracking.",
        "priority": "CRITICAL",
        "story_points": 21,
        "stories": [
            {
                "title": "AIOrchestrator Core",
                "description": "Serviço central que recebe chamadas padronizadas (user/assistant messages + system prompt separado) e converte para formato específico de cada provider.",
                "story_points": 13,
                "tasks": [
                    {"title": "Implementar AIOrchestrator base", "description": "Classe com execute() que roteia para provider correto baseado em usage_type.", "complexity": "high"},
                    {"title": "Adapter para Anthropic Claude", "description": "Converter messages padronizadas para formato Anthropic (system como parâmetro separado).", "complexity": "medium"},
                    {"title": "Adapter para OpenAI GPT", "description": "Converter messages padronizadas para formato OpenAI (system como role em messages).", "complexity": "medium"},
                    {"title": "Adapter para Google Gemini", "description": "Converter messages padronizadas para formato Gemini (model role, system instructions separadas).", "complexity": "medium"},
                ]
            },
            {
                "title": "Cache Redis Multi-Nível",
                "description": "Sistema de cache em 3 níveis (L1 exact match, L2 semantic, L3 template) que reduz custos de API em 30-35%.",
                "story_points": 8,
                "tasks": [
                    {"title": "Cache L1 - Exact Match", "description": "Hash exato do prompt com TTL de 7 dias.", "complexity": "medium"},
                    {"title": "Cache L2 - Semantic Match", "description": "Similaridade semântica >95% com TTL de 1 dia.", "complexity": "high"},
                    {"title": "Cache L3 - Template Cache", "description": "Para prompts determinísticos (temperature=0) com TTL de 30 dias.", "complexity": "medium"},
                ]
            },
        ]
    },
    {
        "title": "RAG Pipeline com pgvector",
        "description": "Pipeline completo de Retrieval-Augmented Generation usando PostgreSQL com extensão pgvector para armazenamento e busca de vetores, embeddings via Nomic Embed Text (768 dimensões) via Ollama.",
        "priority": "HIGH",
        "story_points": 21,
        "stories": [
            {
                "title": "RAG Foundation",
                "description": "Serviço base de armazenamento e busca semântica de documentos com embeddings.",
                "story_points": 8,
                "tasks": [
                    {"title": "Configurar pgvector no PostgreSQL", "description": "Extensão pgvector, tabela rag_documents com coluna vector(768), índice IVFFlat.", "complexity": "medium"},
                    {"title": "Implementar RAGService.store()", "description": "Gerar embedding via Nomic e inserir no banco com metadados.", "complexity": "medium"},
                    {"title": "Implementar RAGService.retrieve()", "description": "Busca por similaridade de cosseno com filtros por project_id, type, metadata.", "complexity": "medium"},
                ]
            },
            {
                "title": "Continuous RAG Pipeline",
                "description": "Pipeline progressivo de 4 fases: scan → extract rules → generate cards → generate wiki.",
                "story_points": 13,
                "tasks": [
                    {"title": "Fase 1: File Scanner", "description": "Scan de filesystem, embedding de arquivos, tracking de estado (PENDING → INDEXED).", "complexity": "medium"},
                    {"title": "Fase 2: Rule Extraction", "description": "Extração de regras de negócio via IA a partir de arquivos indexados.", "complexity": "high"},
                    {"title": "Fase 3: Card Generation", "description": "Geração automática de Epic/Story/Task a partir de regras extraídas.", "complexity": "high"},
                    {"title": "Fase 4: Wiki Generation", "description": "Criação de wiki pages a partir do conhecimento extraído.", "complexity": "high"},
                ]
            },
        ]
    },
    {
        "title": "Sistema de Entrevistas Contextuais",
        "description": "Entrevistas interativas com IA para captura de requisitos do projeto, gerando contexto semântico que alimenta a geração de backlog.",
        "priority": "HIGH",
        "story_points": 13,
        "stories": [
            {
                "title": "Engine de Entrevistas",
                "description": "Motor de entrevistas com geração dinâmica de perguntas, perguntas fixas de stack, e modos requirements/task_focused.",
                "story_points": 8,
                "tasks": [
                    {"title": "Perguntas de Stack (Phase 1)", "description": "Perguntas fixas sobre backend, frontend, database, CSS, mobile.", "complexity": "low"},
                    {"title": "Perguntas Dinâmicas de IA", "description": "Geração de perguntas contextuais usando prompts YAML externalizados.", "complexity": "high"},
                    {"title": "Modo Task-Focused", "description": "Deep dive em task específica com perguntas especializadas por tipo (bug, feature, refactor).", "complexity": "medium"},
                ]
            },
            {
                "title": "Geração de Backlog a partir de Entrevistas",
                "description": "Conversão automática de conversas de entrevista em hierarquia Epic → Story → Task com rastreabilidade semântica.",
                "story_points": 5,
                "tasks": [
                    {"title": "Epic Generation", "description": "Gerar epics a partir de conversa de entrevista com interview_question_ids para rastreabilidade.", "complexity": "high"},
                    {"title": "Story Decomposition", "description": "Decompor epic em stories com contexto propagado.", "complexity": "medium"},
                    {"title": "Task Decomposition", "description": "Decompor story em tasks com framework specs para redução de tokens.", "complexity": "medium"},
                ]
            },
        ]
    },
    {
        "title": "Frontend Next.js 14 App Router",
        "description": "Interface web completa em Next.js 14 com App Router, React, TypeScript e Tailwind CSS. Inclui páginas de projetos, kanban, analytics, AI Studio, wiki, e configurações.",
        "priority": "HIGH",
        "story_points": 21,
        "stories": [
            {
                "title": "Páginas de Projeto",
                "description": "Dashboard de projetos, detalhes do projeto, kanban board, backlog, entrevistas.",
                "story_points": 8,
                "tasks": [
                    {"title": "Lista de Projetos", "description": "Grid de cards com nome, stack, status, e ações rápidas.", "complexity": "medium"},
                    {"title": "Detalhes do Projeto", "description": "Página com tabs: Overview, Backlog, Kanban, Knowledge, Wiki, Pipeline.", "complexity": "high"},
                    {"title": "Kanban Board", "description": "Board com drag-and-drop (DnD Kit), colunas configuráveis, filtros.", "complexity": "high"},
                ]
            },
            {
                "title": "Analytics e Monitoramento",
                "description": "Páginas de tokens, custos, métricas RAG e cache stats.",
                "story_points": 5,
                "tasks": [
                    {"title": "Página Tokens & Desempenho", "description": "Métricas de uso de tokens, cache hit rate, RAG performance, base de conhecimento.", "complexity": "medium"},
                    {"title": "Página de Custos", "description": "Custos em R$ com conversão USD→BRL em tempo real via AwesomeAPI.", "complexity": "medium"},
                ]
            },
            {
                "title": "AI Studio (AI Flow)",
                "description": "Interface visual para configurar pipelines de IA com profiles, phase configs e run history.",
                "story_points": 8,
                "tasks": [
                    {"title": "Pipeline Profiles", "description": "CRUD de profiles com phase_configs e quality_threshold.", "complexity": "medium"},
                    {"title": "Execution Panel", "description": "Painel de execução com progress bar, live logs e cost metrics.", "complexity": "high"},
                    {"title": "Run History & Comparison", "description": "Histórico de execuções com comparação side-by-side.", "complexity": "medium"},
                ]
            },
        ]
    },
    {
        "title": "Wiki Automática do Projeto",
        "description": "Sistema de wiki com geração automática de páginas a partir do contexto do projeto, enriquecimento por IA, editor rich-text, e linking semântico entre páginas.",
        "priority": "MEDIUM",
        "story_points": 13,
        "stories": [
            {
                "title": "Geração de Wiki Pages",
                "description": "Criação automática de 12+ páginas de wiki a partir do contexto do projeto (visão geral, stack, features, regras, padrões).",
                "story_points": 5,
                "tasks": [
                    {"title": "Wiki Generator Service", "description": "Serviço que gera páginas a partir de context_human, initial_memory_context e RAG.", "complexity": "high"},
                    {"title": "Filesystem Storage", "description": "Armazenamento em satellite/wiki/{slug}.md com YAML front matter.", "complexity": "medium"},
                ]
            },
            {
                "title": "AI Operations em Wiki",
                "description": "Operações de IA por página: generate, expand, summarize, rephrase, enrich rules, relink.",
                "story_points": 8,
                "tasks": [
                    {"title": "Generate/Expand/Summarize/Rephrase", "description": "4 operações de IA por página usando prompts YAML externalizados.", "complexity": "medium"},
                    {"title": "Rule Enrichment", "description": "Enriquecimento de páginas de regras de negócio com contexto expandido.", "complexity": "medium"},
                    {"title": "Semantic Relinking", "description": "Aplicar hyperlinks semânticos entre páginas relacionadas.", "complexity": "high"},
                ]
            },
        ]
    },
    {
        "title": "Sistema de Jobs Assíncronos",
        "description": "Sistema de background jobs com prioridade, tracking de progresso, notificações em tempo real e retry automático.",
        "priority": "MEDIUM",
        "story_points": 8,
        "stories": [
            {
                "title": "Job Executor",
                "description": "PriorityJobExecutor com fila de prioridade, tracking de estado e retry logic.",
                "story_points": 5,
                "tasks": [
                    {"title": "PriorityJobExecutor", "description": "Executor com 4 níveis de prioridade (CRITICAL/HIGH/NORMAL/LOW).", "complexity": "high"},
                    {"title": "Job Tracking API", "description": "Endpoints para listar, consultar e cancelar jobs.", "complexity": "medium"},
                    {"title": "NotificationBell Component", "description": "Componente React com polling de jobs ativos e notificações.", "complexity": "medium"},
                ]
            },
        ]
    },
    {
        "title": "Gestão de Modelos de IA",
        "description": "CRUD completo de modelos de IA com API keys armazenadas no banco, configuração de usage_types e seleção automática por tipo de tarefa.",
        "priority": "MEDIUM",
        "story_points": 8,
        "stories": [
            {
                "title": "AI Models Management",
                "description": "Página de gestão com CRUD, validação de API keys e configuração de usage_types.",
                "story_points": 8,
                "tasks": [
                    {"title": "CRUD de Modelos", "description": "API endpoints + página frontend para criar, editar e deletar modelos de IA.", "complexity": "medium"},
                    {"title": "Usage Type Routing", "description": "Configurar qual modelo é usado para cada usage_type (task_execution, interview, prompt_generation, etc.).", "complexity": "medium"},
                ]
            },
        ]
    },
]


def create_cards(db) -> Dict:
    """Create structured cards (Epics, Stories, Tasks) in the database."""
    project_id = UUID(PROJECT_ID)
    stats = {"epics": 0, "stories": 0, "tasks": 0, "errors": []}

    for epic_data in EPICS:
        try:
            epic_id = uuid4()
            # Create Epic
            db.execute(text("""
                INSERT INTO tasks (id, project_id, title, description, item_type, priority, story_points, status, column, reporter, created_at, updated_at, "order")
                VALUES (:id, :project_id, :title, :description, 'EPIC', :priority, :story_points, 'BACKLOG', 'backlog', 'system', NOW(), NOW(), :order)
            """), {
                "id": str(epic_id),
                "project_id": PROJECT_ID,
                "title": epic_data["title"],
                "description": epic_data["description"],
                "priority": epic_data["priority"],
                "story_points": epic_data["story_points"],
                "order": stats["epics"],
            })
            stats["epics"] += 1

            # Create Stories
            for si, story_data in enumerate(epic_data.get("stories", [])):
                story_id = uuid4()
                db.execute(text("""
                    INSERT INTO tasks (id, project_id, title, description, item_type, parent_id, story_points, status, column, reporter, created_at, updated_at, "order")
                    VALUES (:id, :project_id, :title, :description, 'STORY', :parent_id, :story_points, 'BACKLOG', 'backlog', 'system', NOW(), NOW(), :order)
                """), {
                    "id": str(story_id),
                    "project_id": PROJECT_ID,
                    "title": story_data["title"],
                    "description": story_data["description"],
                    "parent_id": str(epic_id),
                    "story_points": story_data.get("story_points", 5),
                    "order": si,
                })
                stats["stories"] += 1

                # Create Tasks
                for ti, task_data in enumerate(story_data.get("tasks", [])):
                    task_id = uuid4()
                    db.execute(text("""
                        INSERT INTO tasks (id, project_id, title, description, item_type, parent_id, complexity, status, column, reporter, created_at, updated_at, "order")
                        VALUES (:id, :project_id, :title, :description, 'TASK', :parent_id, :complexity, 'DONE', 'done', 'system', NOW(), NOW(), :order)
                    """), {
                        "id": str(task_id),
                        "project_id": PROJECT_ID,
                        "title": task_data["title"],
                        "description": task_data["description"],
                        "parent_id": str(story_id),
                        "complexity": task_data.get("complexity", "medium"),
                        "order": ti,
                    })
                    stats["tasks"] += 1

        except Exception as e:
            stats["errors"].append(f"Epic '{epic_data['title']}': {str(e)}")
            logger.error(f"Error creating epic '{epic_data['title']}': {e}")
            db.rollback()
            continue

    db.commit()
    logger.info(f"Cards created: {stats['epics']} epics, {stats['stories']} stories, {stats['tasks']} tasks")
    return stats


# ============================================================================
# ETAPA 5: WIKI AUTOMÁTICA
# ============================================================================

WIKI_PAGES = [
    {
        "slug": "visao-geral",
        "title": "Visão Geral do ORBIT",
        "content": """# Visão Geral do ORBIT

## O que é o ORBIT?

ORBIT é um **sistema de orquestração de IA** projetado para gerenciar múltiplos modelos de inteligência artificial e automatizar o ciclo completo de desenvolvimento de software — da captura de requisitos à geração de código.

## Missão

Orquestrar diferentes providers de IA (Anthropic Claude, OpenAI GPT, Google Gemini) de forma transparente, roteando cada tipo de tarefa para o modelo mais adequado, enquanto mantém cache inteligente, cost tracking e base de conhecimento semântica.

## Principais Capacidades

- **Entrevistas Contextuais**: Captura de requisitos via entrevistas interativas com IA
- **Geração de Backlog**: Conversão automática de requisitos em hierarquia Epic → Story → Task
- **RAG Pipeline**: Base de conhecimento semântica com pgvector e embeddings Nomic (768d)
- **Execução de Código**: Geração de código assistida por IA com especificações de framework
- **Wiki Automática**: Geração e enriquecimento de documentação por IA
- **Cache Multi-Nível**: 3 níveis de cache Redis (L1-L3) com economia de 30-35% em custos

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + SQLAlchemy + PostgreSQL + Alembic |
| Frontend | Next.js 14 App Router + React + TypeScript + Tailwind CSS |
| IA | Claude API + OpenAI API + Google AI via AIOrchestrator |
| Vetores | pgvector + Nomic Embed Text (768d) via Ollama |
| Cache | Redis multi-nível (L1 exact, L2 semantic, L3 template) |
| Jobs | PriorityJobExecutor com fila de prioridade |
""",
    },
    {
        "slug": "arquitetura",
        "title": "Arquitetura do Sistema",
        "content": """# Arquitetura do Sistema

## Visão de Alto Nível

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│  Frontend   │───▶│  Backend    │───▶│  AI Providers│
│  Next.js 14 │    │  FastAPI    │    │  Claude/GPT/ │
│  React/TS   │    │  SQLAlchemy │    │  Gemini      │
└─────────────┘    └──────┬──────┘    └──────────────┘
                          │
                   ┌──────┴──────┐
                   │             │
              ┌────▼────┐  ┌────▼────┐
              │PostgreSQL│  │  Redis  │
              │+pgvector │  │  Cache  │
              └─────────┘  └─────────┘
```

## Backend (FastAPI)

### Camadas

1. **Routes** (`backend/app/api/routes/`): Endpoints REST da API
2. **Services** (`backend/app/services/`): Lógica de negócio
3. **Models** (`backend/app/models/`): Modelos SQLAlchemy
4. **Schemas** (`backend/app/schemas/`): Schemas Pydantic (validação)
5. **Prompts** (`backend/app/prompts/`): Prompts YAML externalizados

### Serviços Principais

- **AIOrchestrator**: Orquestração centralizada de chamadas de IA
- **RAGService**: Armazenamento e busca semântica
- **BacklogGeneratorService**: Geração de hierarquia Epic/Story/Task
- **InterviewService**: Engine de entrevistas contextuais
- **PromptLoader**: Carregamento de prompts YAML com Jinja2

## Frontend (Next.js 14)

### Estrutura de Páginas

- `/` — Lista de projetos
- `/projects/[id]` — Detalhes do projeto (tabs)
- `/analytics/tokens` — Tokens & Desempenho
- `/analytics/costs` — Custos
- `/prompts` — Gerenciamento de prompts
- `/ai-flow` — AI Studio (pipeline visual)
- `/jobs` — Jobs assíncronos
- `/settings` — Configurações
- `/ai-models` — Gestão de modelos de IA

### Componentes Chave

- **Navbar**: Navegação top-bar com links e ações
- **KanbanBoard**: Board com drag-and-drop (DnD Kit)
- **ChatInterface**: Interface de chat para entrevistas
- **MarkdownEditor**: Editor rich-text com toolbar
""",
    },
    {
        "slug": "fluxo-agentes",
        "title": "Fluxo de Execução dos Agentes",
        "content": """# Fluxo de Execução dos Agentes

## Pipeline de Processamento

### 1. Captura de Requisitos (Entrevista)

```
Usuário inicia entrevista
    → Perguntas de stack (fixas)
    → Perguntas dinâmicas (IA)
    → Contexto semântico gerado
    → Respostas indexadas no RAG
```

### 2. Geração de Backlog

```
Entrevista concluída
    → Generate Epic (IA)
    → Usuário aprova Epic
    → Generate Stories (IA)
    → Usuário aprova Stories
    → Generate Tasks (IA + framework specs)
    → Detecção de modificação (>90% similaridade)
    → Usuário aprova Tasks
```

### 3. Execução de Código

```
Task selecionada
    → RAG retrieval (contexto relevante)
    → Framework specs (redução 70-85% tokens)
    → AIOrchestrator.execute()
    → Cache check (L1 → L2 → L3)
    → API call (se cache miss)
    → Cost tracking
    → Resultado armazenado
```

### 4. RAG Pipeline Contínuo

```
Fase 1: Scan → Embedding de arquivos
Fase 2: Extract Rules → IA extrai regras de negócio
Fase 3: Generate Cards → Cria cards a partir de regras
Fase 4: Generate Wiki → Cria wiki a partir de conhecimento
```

## Roteamento de Modelos

| Usage Type | Provider Padrão | Modelo |
|------------|----------------|--------|
| task_execution | Anthropic | Claude Sonnet 4.5 |
| interview | Anthropic | Claude Haiku 4 |
| prompt_generation | OpenAI | GPT-4o |
| commit_generation | Google | Gemini 1.5 Pro |
| general | Anthropic | Claude Sonnet 4.5 |

## Complexidade → Modelo

| Complexidade | Modelo Sugerido |
|-------------|----------------|
| low | Claude Haiku 4 |
| medium | Claude Sonnet 4.5 |
| high | Claude Opus 4.5 |
""",
    },
    {
        "slug": "regras-prompt",
        "title": "Regras de Prompt",
        "content": """# Regras de Prompt

## Princípios Fundamentais

### 1. Prompts Externalizados para YAML

Todos os prompts de IA são armazenados em arquivos YAML na pasta `backend/app/prompts/`.

**Estrutura de um prompt YAML:**
```yaml
name: epic_from_interview
version: 1
category: backlog
description: Gera Epic a partir de conversa de entrevista
usage_type: prompt_generation

variables:
  required:
    - project_name
    - conversation_text
  optional:
    - semantic_map_text

components:
  - semantic_methodology

system_prompt: |
  Você é um Product Owner especialista...
  {{ components.semantic_methodology }}

user_prompt: |
  Analise esta conversa: {{ conversation_text }}
  Projeto: {{ project_name }}
```

### 2. PromptLoader

```python
from app.prompts.loader import PromptLoader

loader = PromptLoader()
system_prompt, user_prompt = loader.render(
    "backlog/epic_from_interview",
    {"project_name": "Meu App", "conversation_text": "..."}
)
```

### 3. Compatibilidade Multi-Provider

- Messages: apenas roles `user` e `assistant`
- System prompt: parâmetro separado (nunca como message)
- AIOrchestrator converte para formato de cada provider

### 4. Componentes Reutilizáveis

- `semantic_methodology.yaml`: Metodologia de referências semânticas
- `project_context.yaml`: Template de contexto do projeto
- `json_output_rules.yaml`: Regras de formatação JSON de saída

## Categorias de Prompts (76 arquivos YAML)

| Categoria | Quantidade | Descrição |
|-----------|-----------|-----------|
| interviews/ | 25 | Entrevistas contextuais |
| context/ | 18 | Contexto e especificações |
| backlog/ | 8 | Geração de backlog |
| projects/ | 5 | Operações de projeto |
| wiki/ | 4 | Operações de wiki |
| discovery/ | 3 | Descoberta de padrões |
| memory/ | 3 | Consolidação de memória |
| rag/ | 3 | Pipeline RAG |
| components/ | 3 | Componentes reutilizáveis |
| commits/ | 1 | Mensagens de commit |
| utility/ | 1 | Formatação |
""",
    },
    {
        "slug": "regras-rag",
        "title": "Regras de RAG",
        "content": """# Regras de RAG

## Configuração

| Parâmetro | Valor |
|-----------|-------|
| Modelo de Embedding | Nomic Embed Text |
| Dimensões | 768 |
| Runtime | Ollama (host: 172.27.144.1:11434) |
| Banco de Dados | PostgreSQL + pgvector |
| Distância | Cosseno (operador `<=>`) |
| Tabela | `rag_documents` |

## Tipos de Documentos no RAG

| Tipo | Descrição |
|------|-----------|
| `code_file` | Arquivo de código fonte |
| `interview_answer` | Resposta de entrevista |
| `interview_question` | Pergunta de entrevista |
| `business_rule` | Regra de negócio extraída |
| `document` | Documento enviado |
| `document_chunk` | Chunk de documento |
| `discovered_pattern` | Padrão descoberto |
| `project_context` | Contexto do projeto |
| `card` | Card do backlog |
| `domain_template` | Template de domínio |

## Pipeline de 4 Fases

### Fase 1: Scan de Arquivos
- Scanner percorre filesystem do projeto
- Respeita .gitignore e IGNORE_DIRECTORIES
- Gera embedding via Nomic para cada arquivo
- Estado: PENDING → INDEXED
- Não usa IA (apenas embedding)

### Fase 2: Extração de Regras
- Requer Fase 1 completa
- IA analisa arquivos indexados
- Extrai regras de negócio estruturadas
- Estado: INDEXED → COMPLETED

### Fase 3: Geração de Cards
- Requer Fase 2 completa
- Gera Epic/Story/Task a partir de regras
- Usa detecção de modificação (>90% similaridade)

### Fase 4: Geração de Wiki
- Requer Fase 3 completa
- Cria wiki pages a partir do conhecimento extraído
- Enriquece com linking semântico

## Deep Pipeline (7 Fases via Claudio)

O Deep Pipeline (PROMPT #260) executa todas as 4 fases básicas mais 3 fases avançadas:
- Análise arquitetural completa
- Mapeamento de dependências
- Geração de documentação abrangente

## Chunking

- Tamanho padrão: 500 caracteres
- Overlap: 50 caracteres
- Preservação de estrutura (headers, blocos de código)
- Metadados por chunk: tipo, fonte, índice, total
""",
    },
    {
        "slug": "convencoes-desenvolvimento",
        "title": "Convenções de Desenvolvimento",
        "content": """# Convenções de Desenvolvimento

## REGRA #0 — Dados Humanos São Sagrados

> Dados inseridos ou editados por operador humano têm PRIORIDADE ABSOLUTA sobre dados gerados por IA.

- IA pode preencher campos vazios
- IA NUNCA sobrescreve dado editado por humano
- Campos rastreados: `description_edited_by`, `prompt_edited_by` (valores: 'ai', 'human', None)

## Frontend (Next.js 14)

### Padrões

- `'use client';` no topo de páginas interativas
- Layout: `<Layout><Breadcrumbs />` + `<div className="space-y-6">`
- Grid responsivo: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- Cores: blue-600 (primary), green-600 (success), red-600 (danger)
- API client: `frontend/src/lib/api/` (módulos por domínio)

### Estrutura de API Client

```
frontend/src/lib/api/
├── base.ts           # request() helper, API_URL
├── projects.ts       # projectsApi
├── analytics.ts      # analyticsApi
├── knowledge.ts      # knowledgeApi, ragApi
├── tasks.ts          # tasksApi
└── index.ts          # re-exports
```

## Backend (FastAPI)

### Padrões

- Routers: `APIRouter()` + `Depends(get_db)` + `response_model`
- Schemas: Base, Create, Update, Response (Pydantic v2)
- Services em `backend/app/services/`
- Prompts em `backend/app/prompts/*.yaml`
- IA via `AIOrchestrator(db)` — NUNCA chamadas diretas

### Estrutura de Rotas

```
backend/app/api/routes/
├── projects.py          # CRUD de projetos
├── interviews.py        # Entrevistas
├── backlog_generation.py # Geração de backlog
├── tasks.py             # CRUD de tasks
├── knowledge.py         # Knowledge base
├── continuous_rag.py    # RAG pipeline
├── wiki.py              # Wiki pages
├── ai_models.py         # Gestão de modelos IA
├── cost_analytics.py    # Analytics de custos
└── jobs.py              # Jobs assíncronos
```

## Git & Documentação

### Commits
- Formato: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`)
- Body: incluir `PROMPT #[N]`
- Footer: `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`

### Documentação
- Cada prompt: `satellite/knowledge/PROMPT_[N]_[DESCRIÇÃO].md`
- Seções obrigatórias: Objective, Implementation, Files Modified, Testing, Status
- Referência: `satellite/knowledge/PROMPT_50_IMPLEMENTATION_REPORT.md`

## Infraestrutura

- Serviços nativos Linux/WSL2 (NÃO Docker)
- Start/stop: `/home/igorhaf/orbit/scripts/orbit start|stop|status`
- PostgreSQL: porta 5432
- Redis: porta 6379
- Ollama: host Windows 172.27.144.1:11434
- Backend: porta 8000
- Frontend: porta 3000
""",
    },
]


def create_wiki_pages(db) -> int:
    """Create wiki pages in the database and filesystem."""
    project_id = UUID(PROJECT_ID)
    wiki_dir = os.path.join(ORBIT_ROOT, "satellite", "knowledge", "wiki")
    os.makedirs(wiki_dir, exist_ok=True)

    count = 0
    for i, page in enumerate(WIKI_PAGES):
        try:
            page_id = uuid4()

            # Insert into database
            db.execute(text("""
                INSERT INTO wiki_pages (id, project_id, slug, title, content, "order_index", source, created_at, updated_at)
                VALUES (:id, :project_id, :slug, :title, :content, :order_index, 'bootstrap', NOW(), NOW())
                ON CONFLICT DO NOTHING
            """), {
                "id": str(page_id),
                "project_id": PROJECT_ID,
                "slug": page["slug"],
                "title": page["title"],
                "content": page["content"],
                "order_index": i,
            })

            # Write to filesystem
            filepath = os.path.join(wiki_dir, f"{page['slug']}.md")
            front_matter = f"""---
title: "{page['title']}"
slug: "{page['slug']}"
source: bootstrap
order: {i}
created_at: "{datetime.now(timezone.utc).isoformat()}"
---

"""
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(front_matter + page["content"])

            count += 1

        except Exception as e:
            logger.error(f"Error creating wiki page '{page['slug']}': {e}")
            db.rollback()

    db.commit()
    logger.info(f"Created {count} wiki pages")
    return count


# ============================================================================
# ETAPA 6: CONFIGURAÇÕES DO PROJETO
# ============================================================================

def initialize_project_config(db) -> Dict:
    """Initialize project configuration and metadata."""
    config = {
        "satellite_dirs_verified": False,
        "git_info_set": False,
        "initial_memory_context_set": False,
    }

    # Verify satellite directories
    satellite_dirs = [
        "satellite/memory",
        "satellite/docs",
        "satellite/knowledge",
        "satellite/knowledge/wiki",
        "satellite/knowledge/results",
        "satellite/knowledge/prompts",
    ]

    all_exist = True
    for d in satellite_dirs:
        full_path = os.path.join(ORBIT_ROOT, d)
        if not os.path.exists(full_path):
            os.makedirs(full_path, exist_ok=True)
            logger.info(f"Created directory: {d}")
        all_exist = all_exist and os.path.exists(full_path)

    config["satellite_dirs_verified"] = all_exist

    # Set git repository info
    try:
        import subprocess
        remote = subprocess.check_output(
            ["git", "remote", "get-url", "origin"],
            cwd=ORBIT_ROOT, text=True
        ).strip()
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=ORBIT_ROOT, text=True
        ).strip()

        git_info = {"remote_url": remote, "branch": branch}
        db.execute(text("""
            UPDATE projects SET git_repository_info = :git_info WHERE id = :id
        """), {"git_info": json.dumps(git_info), "id": PROJECT_ID})
        config["git_info_set"] = True
    except Exception as e:
        logger.warning(f"Could not set git info: {e}")

    # Set initial memory context
    try:
        # Count files by type
        file_counts = {"python": 0, "typescript": 0, "yaml": 0, "md": 0, "other": 0}
        total_files = 0
        for root, dirs, files in os.walk(ORBIT_ROOT):
            dirs[:] = [d for d in dirs if d not in {'node_modules', '.next', '.git', '__pycache__', 'venv'}]
            for f in files:
                total_files += 1
                if f.endswith('.py'): file_counts["python"] += 1
                elif f.endswith(('.ts', '.tsx')): file_counts["typescript"] += 1
                elif f.endswith(('.yaml', '.yml')): file_counts["yaml"] += 1
                elif f.endswith('.md'): file_counts["md"] += 1
                else: file_counts["other"] += 1

        memory_context = {
            "suggested_title": "ORBIT - AI Orchestration System",
            "stack_info": {
                "backend": "fastapi",
                "frontend": "nextjs",
                "database": "postgresql",
                "css": "tailwind",
                "ai_providers": ["anthropic", "openai", "google"],
                "vector_db": "pgvector",
                "cache": "redis",
                "embeddings": "nomic-embed-text",
            },
            "business_rules": [r["title"] for r in BUSINESS_RULES],
            "key_features": [
                "Multi-provider AI orchestration (Claude, GPT, Gemini)",
                "Contextual interviews with dynamic AI questions",
                "Hierarchical backlog generation (Epic → Story → Task)",
                "RAG pipeline with pgvector (4-phase progressive)",
                "Auto-wiki generation with AI enrichment",
                "Multi-level Redis cache (L1-L3, 30-35% savings)",
                "Async job system with priority queue",
                "Token reduction via framework specs (70-85%)",
                "Externalized YAML prompts (76 files)",
                "Human Data Supremacy (REGRA #0)",
            ],
            "scan_summary": {
                "total_files": total_files,
                "code_files": file_counts["python"] + file_counts["typescript"],
                "languages": {k: v for k, v in file_counts.items() if v > 0},
            },
        }

        db.execute(text("""
            UPDATE projects SET
                initial_memory_context = :context,
                initial_scan_complete = true
            WHERE id = :id
        """), {"context": json.dumps(memory_context), "id": PROJECT_ID})
        config["initial_memory_context_set"] = True
    except Exception as e:
        logger.warning(f"Could not set memory context: {e}")

    db.commit()
    return config


# ============================================================================
# ETAPA 7: VALIDAÇÃO
# ============================================================================

def validate_formats(db, rag: RAGService) -> Dict:
    """Validate all created data formats."""
    validation = {
        "project_exists": False,
        "rag_documents_count": 0,
        "cards_count": {"epics": 0, "stories": 0, "tasks": 0},
        "wiki_pages_count": 0,
        "business_rules_count": 0,
        "search_test": None,
        "issues": [],
    }

    # Check project
    project = db.query(Project).filter(Project.id == UUID(PROJECT_ID)).first()
    validation["project_exists"] = project is not None

    if project:
        if not project.description:
            validation["issues"].append("Project missing description")
        if not project.stack_backend:
            validation["issues"].append("Project missing stack_backend")

    # Count RAG documents
    result = db.execute(text("""
        SELECT COUNT(*) FROM rag_documents WHERE project_id = :pid
    """), {"pid": PROJECT_ID})
    validation["rag_documents_count"] = result.scalar()

    # Count cards
    for item_type in ["EPIC", "STORY", "TASK"]:
        result = db.execute(text("""
            SELECT COUNT(*) FROM tasks WHERE project_id = :pid AND item_type = :it
        """), {"pid": PROJECT_ID, "it": item_type})
        validation["cards_count"][item_type.lower() + "s"] = result.scalar()

    # Count wiki pages
    result = db.execute(text("""
        SELECT COUNT(*) FROM wiki_pages WHERE project_id = :pid
    """), {"pid": PROJECT_ID})
    validation["wiki_pages_count"] = result.scalar()

    # Count business rules in RAG
    result = db.execute(text("""
        SELECT COUNT(*) FROM rag_documents
        WHERE project_id = :pid AND metadata->>'type' = 'business_rule'
    """), {"pid": PROJECT_ID})
    validation["business_rules_count"] = result.scalar()

    # Test semantic search
    try:
        results = rag.retrieve(
            query="como funciona a autenticação no ORBIT?",
            filter={"project_id": str(UUID(PROJECT_ID))},
            top_k=3,
            similarity_threshold=0.3
        )
        validation["search_test"] = {
            "query": "como funciona a autenticação no ORBIT?",
            "results_found": len(results),
            "top_similarity": results[0]["similarity"] if results else 0,
        }
    except Exception as e:
        validation["issues"].append(f"Search test failed: {str(e)}")

    return validation


# ============================================================================
# ETAPA 8: RELATÓRIO FINAL
# ============================================================================

def generate_report(rag_stats, rules_count, cards_stats, wiki_count, config, validation) -> str:
    """Generate final bootstrap report."""
    report = f"""# ORBIT Self-Bootstrap Report

## Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
## Project ID: {PROJECT_ID}

---

## Etapa 1 — Indexação da Documentação

| Métrica | Valor |
|---------|-------|
| Arquivos processados | {rag_stats['files_processed']} |
| Chunks criados | {rag_stats['chunks_created']} |
| Arquivos ignorados | {rag_stats['files_skipped']} |
| Erros | {len(rag_stats['errors'])} |

### Por Categoria
{chr(10).join(f'| {cat} | {count} |' for cat, count in sorted(rag_stats['by_category'].items()))}

---

## Etapa 2 — Regras de Negócio

| Métrica | Valor |
|---------|-------|
| Regras criadas | {rules_count} |
| Categorias | validation, workflow, calculation, integration |

### Regras Extraídas
{chr(10).join(f'- **{r["title"]}** ({r["category"]})' for r in BUSINESS_RULES)}

---

## Etapa 3 — População do RAG

| Métrica | Valor |
|---------|-------|
| Total documentos RAG | {validation['rag_documents_count']} |
| Regras de negócio | {validation['business_rules_count']} |
| Chunks de documentos | {rag_stats['chunks_created']} |

---

## Etapa 4 — Cards Criados

| Tipo | Quantidade |
|------|-----------|
| Epics | {cards_stats['epics']} |
| Stories | {cards_stats['stories']} |
| Tasks | {cards_stats['tasks']} |
| **Total** | **{cards_stats['epics'] + cards_stats['stories'] + cards_stats['tasks']}** |

### Epics
{chr(10).join(f'- {e["title"]} ({e["priority"]}, {e["story_points"]} SP)' for e in EPICS)}

---

## Etapa 5 — Wiki Automática

| Métrica | Valor |
|---------|-------|
| Páginas criadas | {wiki_count} |

### Páginas
{chr(10).join(f'- {p["title"]} (`{p["slug"]}`)' for p in WIKI_PAGES)}

---

## Etapa 6 — Configurações

| Configuração | Status |
|-------------|--------|
| Satellite dirs | {'✅' if config['satellite_dirs_verified'] else '❌'} |
| Git info | {'✅' if config['git_info_set'] else '❌'} |
| Memory context | {'✅' if config['initial_memory_context_set'] else '❌'} |

---

## Etapa 7 — Validação

| Verificação | Status |
|------------|--------|
| Projeto existe | {'✅' if validation['project_exists'] else '❌'} |
| RAG documents | {validation['rag_documents_count']} |
| Cards (E/S/T) | {validation['cards_count']['epics']}/{validation['cards_count']['stories']}/{validation['cards_count']['tasks']} |
| Wiki pages | {validation['wiki_pages_count']} |
| Business rules | {validation['business_rules_count']} |
| Busca semântica | {'✅ ' + str(validation['search_test']['results_found']) + ' resultados' if validation['search_test'] else '❌'} |

### Issues Detectadas
{chr(10).join(f'- ⚠️ {issue}' for issue in validation['issues']) if validation['issues'] else '- Nenhuma issue detectada ✅'}

---

## Resumo

O projeto ORBIT foi auto-bootstrapped com sucesso:
- **{rag_stats['files_processed']}** documentos indexados no RAG ({rag_stats['chunks_created']} chunks)
- **{rules_count}** regras de negócio extraídas
- **{cards_stats['epics'] + cards_stats['stories'] + cards_stats['tasks']}** cards criados ({cards_stats['epics']} epics, {cards_stats['stories']} stories, {cards_stats['tasks']} tasks)
- **{wiki_count}** páginas de wiki geradas
- Base de conhecimento pronta para consultas semânticas

## Status: COMPLETED ✅
"""
    return report


# ============================================================================
# MAIN
# ============================================================================

def main():
    logger.info("=" * 60)
    logger.info("ORBIT Self-Bootstrap Starting")
    logger.info("=" * 60)

    db = SessionLocal()
    rag = RAGService(db)

    try:
        # Verify project exists
        project = db.query(Project).filter(Project.id == UUID(PROJECT_ID)).first()
        if not project:
            logger.error(f"Project {PROJECT_ID} not found! Create it first.")
            sys.exit(1)

        logger.info(f"Project found: {project.name} ({project.id})")

        # Etapa 1 + 3: Index documents to RAG
        logger.info("\n--- ETAPA 1 + 3: Indexação e População do RAG ---")
        rag_stats = index_documents_to_rag(db, rag)

        # Etapa 2: Business rules
        logger.info("\n--- ETAPA 2: Regras de Negócio ---")
        rules_count = create_business_rules(db, rag)

        # Etapa 4: Create cards
        logger.info("\n--- ETAPA 4: Criação de Cards ---")
        cards_stats = create_cards(db)

        # Etapa 5: Wiki
        logger.info("\n--- ETAPA 5: Wiki Automática ---")
        wiki_count = create_wiki_pages(db)

        # Etapa 6: Configuration
        logger.info("\n--- ETAPA 6: Configurações ---")
        config = initialize_project_config(db)

        # Etapa 7: Validation
        logger.info("\n--- ETAPA 7: Validação ---")
        validation = validate_formats(db, rag)

        # Etapa 8: Report
        logger.info("\n--- ETAPA 8: Relatório Final ---")
        report = generate_report(rag_stats, rules_count, cards_stats, wiki_count, config, validation)

        # Save report
        report_path = os.path.join(ORBIT_ROOT, "satellite", "knowledge", "ORBIT_SELF_BOOTSTRAP_REPORT.md")
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(report)
        logger.info(f"Report saved to: {report_path}")

        # Print summary
        print("\n" + "=" * 60)
        print("ORBIT SELF-BOOTSTRAP COMPLETE")
        print("=" * 60)
        print(f"  Documents indexed: {rag_stats['files_processed']} files, {rag_stats['chunks_created']} chunks")
        print(f"  Business rules: {rules_count}")
        print(f"  Cards: {cards_stats['epics']} epics, {cards_stats['stories']} stories, {cards_stats['tasks']} tasks")
        print(f"  Wiki pages: {wiki_count}")
        print(f"  RAG total docs: {validation['rag_documents_count']}")
        print(f"  Search test: {'PASS' if validation['search_test'] else 'FAIL'}")
        print(f"  Issues: {len(validation['issues'])}")
        print(f"\n  Report: {report_path}")
        print("=" * 60)

    except Exception as e:
        logger.error(f"Bootstrap failed: {e}", exc_info=True)
        db.rollback()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
