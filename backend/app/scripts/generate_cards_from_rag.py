#!/usr/bin/env python3
"""
Card Hierarchy Generator from RAG Business Rules

Generates a complete card hierarchy (Epics → Stories → Tasks)
from business rules stored in the RAG system. Uses ONLY data already in RAG,
no AI model calls.

Structure (rigid, same for every card):
  - title: str
  - description: str (human-readable markdown)
  - generated_prompt: str (semantic markdown with references)
  - acceptance_criteria: list[dict] (testable items)
  - story_points: int (Fibonacci)
  - priority: str (critical/high/medium/low)
  - labels: list[str]
  - interview_insights: dict (semantic_map, derived_from)
  - description_edited_by: 'ai'
  - prompt_edited_by: 'ai'
  - workflow_state: 'open'

Usage:
  cd /home/igorhaf/orbit/backend
  poetry run python -m app.scripts.generate_cards_from_rag

PROMPT #239 - Card Hierarchy from RAG Business Rules
"""

import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from uuid import UUID, uuid4

backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(backend_dir))
os.chdir(backend_dir)

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

PROJECT_ID = UUID("0c9afa06-cda9-489f-85d1-5d6c67407f32")
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://orbit:orbit_password@localhost:5432/orbit")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

NOW = datetime.utcnow()


# ============================================================
# Card template - rigid structure applied to ALL cards
# ============================================================

def make_card(
    project_id: UUID,
    parent_id,
    item_type: str,
    title: str,
    description: str,
    generated_prompt: str,
    acceptance_criteria: list,
    story_points: int,
    priority: str,
    order: int,
    labels: list,
    semantic_map: dict,
    derived_from: str = None,
) -> dict:
    """
    Build a card dict with RIGID structure. Every card has the exact same fields.
    """
    card_id = uuid4()
    return {
        "id": str(card_id),
        "project_id": str(project_id),
        "parent_id": str(parent_id) if parent_id else None,
        "item_type": item_type,
        "title": title,
        "description": description,
        "generated_prompt": generated_prompt,
        "acceptance_criteria": json.dumps(acceptance_criteria),
        "story_points": story_points,
        "priority": priority,
        "status": "backlog",
        "column": "backlog",
        "order": order,
        "labels": json.dumps(labels),
        "workflow_state": "open",
        "reporter": "system",
        "description_edited_by": "ai",
        "prompt_edited_by": "ai",
        "interview_insights": json.dumps({
            "semantic_map": semantic_map,
            "derived_from": derived_from,
            "source": "rag_business_rules",
        }),
        "components": json.dumps([]),
        "comments": json.dumps([]),
        "depends_on": json.dumps([]),
        "status_history": json.dumps([]),
        "interview_question_ids": json.dumps([]),
        "generation_context": json.dumps({}),
        "created_at": NOW,
        "updated_at": NOW,
    }


def render_description(title: str, context: str, rules: list, level: str) -> str:
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


def render_prompt(title: str, semantic_map: dict, rules: list, level: str) -> str:
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


def make_acceptance_criteria(rules: list) -> list:
    """Convert rules to acceptance criteria format."""
    criteria = []
    for r in rules[:6]:
        text = r.strip()
        if len(text) > 20:
            criteria.append({"text": text[:200], "completed": False})
    if not criteria:
        criteria.append({"text": "Funcionalidade implementada conforme especificacao", "completed": False})
    return criteria


# ============================================================
# ORBIT Business Domain - Hierarchy Definition
# Based on ORBIT_BUSINESS_ANALYST_REPORT.md sections
# ============================================================

HIERARCHY = [
    {
        "title": "Gestao de Projetos e Codigo-Fonte",
        "context": "Gerenciamento de projetos vinculados a bases de codigo existentes. Inclui criacao, configuracao, analise automatica de stack tecnologica, extracao de regras de negocio e deteccao de padroes.",
        "priority": "critical",
        "story_points": 21,
        "semantic_map": {
            "N1": "Projeto",
            "N2": "Base de codigo",
            "P1": "Criacao de projeto",
            "P2": "Memory scan",
            "E1": "Analise de stack",
            "E2": "Extracao de regras",
            "D1": "code_path obrigatorio",
        },
        "labels": ["backend", "core"],
        "stories": [
            {
                "title": "Criacao e Configuracao de Projetos",
                "context": "Fluxo de criacao de projeto com code_path obrigatorio, wizard de 4 passos e scan automatico.",
                "rules": [
                    "Projeto requer code_path obrigatorio apontando para pasta existente",
                    "Wizard de criacao: Nome → Entrevista → Review → Confirmar",
                    "code_path e imutavel apos criacao",
                    "Projeto cria estrutura satellite/ automaticamente",
                    "Scan de memoria analisa 30/100/todos arquivos conforme nivel",
                ],
                "tasks": [
                    {"title": "Validacao de code_path", "rules": ["Verificar existencia da pasta", "Rejeitar caminhos invalidos", "Impedir alteracao apos criacao"]},
                    {"title": "Wizard de criacao de projeto", "rules": ["4 passos sequenciais", "Navegacao entre passos", "Cancelamento limpa projeto abandonado"]},
                    {"title": "Estrutura satellite/ automatica", "rules": ["Criar memory/, docs/, knowledge/", "Criar subpastas wiki/, results/, prompts/", "Idempotente - seguro chamar multiplas vezes"]},
                    {"title": "Scan de memoria do codigo", "rules": ["3 niveis de profundidade", "Identificar stack tecnologica", "Extrair regras de negocio do codigo", "Detectar padroes arquiteturais"]},
                ]
            },
            {
                "title": "Analise Automatica de Stack Tecnologica",
                "context": "Identificacao automatica de linguagens, frameworks, banco de dados e padroes utilizados no projeto.",
                "rules": [
                    "Detectar linguagens de programacao",
                    "Identificar frameworks (Laravel, Next.js, etc)",
                    "Detectar banco de dados utilizado",
                    "Armazenar resultado na base de conhecimento RAG",
                ],
                "tasks": [
                    {"title": "Deteccao de linguagens", "rules": ["Analisar extensoes de arquivo", "Contar linhas por linguagem", "Identificar linguagem principal"]},
                    {"title": "Identificacao de frameworks", "rules": ["Detectar por arquivos de configuracao", "Mapear dependencias do package manager", "Classificar por categoria (backend/frontend/db)"]},
                    {"title": "Indexacao no RAG", "rules": ["Armazenar stack como regra de negocio", "Tipo: domain, fonte: memory_scan", "Embeddings 384-dim via all-MiniLM-L6-v2"]},
                ]
            },
            {
                "title": "Extracao de Regras de Negocio do Codigo",
                "context": "Analise automatica de arquivos para extrair validacoes, fluxos, permissoes e calculos embutidos no codigo.",
                "rules": [
                    "Extrair validacoes de formularios e requests",
                    "Identificar fluxos de trabalho (state machines)",
                    "Detectar regras de permissao e acesso",
                    "Classificar regras por tipo e prioridade",
                    "Armazenar no RAG com metadata estruturada",
                ],
                "tasks": [
                    {"title": "Scanner de validacoes", "rules": ["Analisar arquivos de validacao", "Extrair regras de campos obrigatorios", "Detectar formatos e limites"]},
                    {"title": "Scanner de fluxos de trabalho", "rules": ["Identificar state machines", "Mapear transicoes de estado", "Extrair pre-condicoes e pos-condicoes"]},
                    {"title": "Classificacao e priorizacao", "rules": ["Classificar por tipo: domain/validation/constraint/workflow", "Atribuir prioridade: high/normal/low", "Interface rules tem prioridade maxima"]},
                ]
            }
        ]
    },
    {
        "title": "Entrevista de Contexto e Geracao de Backlog",
        "context": "Sistema de entrevista com IA para captura de contexto do projeto e geracao hierarquica de itens de trabalho (Epicos, Stories, Tasks).",
        "priority": "critical",
        "story_points": 21,
        "semantic_map": {
            "N1": "Entrevista de contexto",
            "N2": "Contexto imutavel",
            "P1": "Perguntas fixas Q1-Q3",
            "P2": "Perguntas contextuais IA",
            "E1": "Geracao de epicos",
            "D1": "Context lock apos primeiro epic",
            "AC1": "Dual output: semantico + humano",
        },
        "labels": ["backend", "ai", "core"],
        "stories": [
            {
                "title": "Entrevista de Contexto com IA",
                "context": "Entrevista guiada que coleta contexto do projeto. 3 perguntas fixas obrigatorias + perguntas contextuais geradas pela IA.",
                "rules": [
                    "3 perguntas fixas obrigatorias (Q1-Q3)",
                    "Perguntas contextuais ilimitadas geradas pela IA",
                    "Usuario decide quando encerrar",
                    "Suporte a perguntas abertas e fechadas com opcoes",
                    "Contexto travado apos primeiro Epic aprovado",
                ],
                "tasks": [
                    {"title": "Perguntas fixas Q1-Q3", "rules": ["Q1: Proposito do projeto", "Q2: Tecnologias e frameworks", "Q3: Modulos ou funcionalidades principais"]},
                    {"title": "Geracao de perguntas contextuais", "rules": ["Baseadas em respostas anteriores", "Baseadas na analise do codigo", "Perguntas com opcoes quando aplicavel"]},
                    {"title": "Context lock", "rules": ["Travar apos primeiro Epic aprovado", "Gerar dual output: semantico + humano", "Contexto e imutavel uma vez travado"]},
                    {"title": "Encerramento da entrevista", "rules": ["Botao 'Gerar Contexto' disponivel apos Q3", "Gerar resumo do contexto", "Sugerir 8-20 epicos macro"]},
                ]
            },
            {
                "title": "Geracao Hierarquica de Cards",
                "context": "Geracao em cascata: Epic aprovado gera Stories, Story aprovada gera Tasks.",
                "rules": [
                    "Epic aprovado gera 15-20 Stories draft",
                    "Story aprovada gera 5-8 Tasks draft",
                    "Task e nivel folha (sem filhos)",
                    "Cada card tem: titulo, descricao, prompt, criterios, story points",
                    "REGRA #0: dados humanos nunca sobrescritos por IA",
                ],
                "tasks": [
                    {"title": "Geracao de Stories a partir de Epic", "rules": ["15-20 stories por epic", "Herdar semantic map do pai", "Labels: suggested, workflow: draft"]},
                    {"title": "Geracao de Tasks a partir de Story", "rules": ["5-8 tasks por story", "Herdar contexto hierarquico", "Story points: 1-8"]},
                    {"title": "Ativacao de cards sugeridos", "rules": ["Remover label 'suggested'", "Alterar workflow_state para 'open'", "Gerar conteudo completo via IA"]},
                ]
            },
            {
                "title": "Dual Output: Semantico e Humano",
                "context": "Cada card gerado tem dois campos: description (humano) e generated_prompt (semantico com referencias N1, P1, E1, etc).",
                "rules": [
                    "description: texto humano legivel para UI",
                    "generated_prompt: texto semantico com identificadores",
                    "Funcao _convert_semantic_to_human() converte via regex",
                    "Mapa semantico armazenado em interview_insights",
                    "Identificadores unicos e imutaveis (N1, P1, E1, D1, S1, C1, AC1)",
                ],
                "tasks": [
                    {"title": "Geracao de texto semantico", "rules": ["Identificadores N1-P1-E1-D1-S1-C1-AC1", "Mapa semantico no cabecalho", "Criterios de aceitacao com AC1, AC2"]},
                    {"title": "Conversao para texto humano", "rules": ["Regex substitui identificadores por significados", "Remove secao Mapa Semantico", "Resultado legivel para usuario"]},
                    {"title": "Tracking REGRA #0", "rules": ["description_edited_by: ai ou human", "prompt_edited_by: ai ou human", "IA nunca sobrescreve edicao humana"]},
                ]
            }
        ]
    },
    {
        "title": "Orquestracao de IA Multi-Provider",
        "context": "Sistema de orquestracao que suporta 3+ providers de IA (Anthropic, OpenAI, Google, Ollama, Cohere) com fallback chain e cache Redis.",
        "priority": "high",
        "story_points": 13,
        "semantic_map": {
            "N1": "AIOrchestrator",
            "N2": "Provider de IA",
            "P1": "Execute com fallback",
            "E1": "Chain fallback visual",
            "D1": "Cache Redis 3 niveis",
            "AC1": "Compatibilidade multi-provider",
        },
        "labels": ["backend", "ai", "infrastructure"],
        "stories": [
            {
                "title": "AIOrchestrator com Fallback Chain",
                "context": "Orquestrador central que roteia chamadas de IA com fallback automatico entre providers.",
                "rules": [
                    "execute() tenta cada modelo na chain em sequencia",
                    "Fallback automatico em caso de falha",
                    "Mensagens padronizadas: apenas roles user/assistant",
                    "System prompt passado como parametro separado",
                    "API keys armazenadas no banco (tabela ai_models), nunca em .env",
                ],
                "tasks": [
                    {"title": "Roteamento por usage_type", "rules": ["task_execution, interview, prompt_generation, commit_generation, general", "Modelo configuravel por operacao", "Fallback para modelo 'general'"]},
                    {"title": "Chain fallback automatico", "rules": ["Tentar modelos em sequencia", "Registrar falhas e sucessos", "Metricas por modelo: success_rate, latencia, custo"]},
                    {"title": "Compatibilidade de roles", "rules": ["Anthropic: user/assistant, system separado", "OpenAI: system/user/assistant em messages", "Gemini: user/model, system instructions separadas"]},
                ]
            },
            {
                "title": "Cache Redis Multi-Nivel",
                "context": "Cache de 3 niveis para chamadas de IA: exact match (7 dias), semantic match (1 dia), template cache (30 dias).",
                "rules": [
                    "L1 - Exact Match: hash do prompt, TTL 7 dias",
                    "L2 - Semantic Match: similaridade >95%, TTL 1 dia",
                    "L3 - Template Cache: temperature=0, TTL 30 dias",
                    "Hit rate esperado: 30-35%",
                    "Fallback para cache in-memory se Redis indisponivel",
                ],
                "tasks": [
                    {"title": "Implementar L1 Exact Match", "rules": ["Hash SHA-256 do prompt completo", "TTL de 7 dias", "Hit rate esperado: ~20%"]},
                    {"title": "Implementar L2 Semantic Match", "rules": ["Similaridade de embeddings >95%", "TTL de 1 dia", "Hit rate esperado: ~10%"]},
                    {"title": "Implementar L3 Template Cache", "rules": ["Apenas para temperature=0", "TTL de 30 dias", "Hit rate esperado: ~5%"]},
                ]
            },
            {
                "title": "AI Flow - Configuracao Visual",
                "context": "Interface visual estilo diagrama de fluxo para configurar chains de fallback por operacao.",
                "rules": [
                    "Diagrama Start → Model1 → Model2 → Error",
                    "Nos coloridos por provider",
                    "Metricas em tempo real nos nos",
                    "Reordenacao por drag-and-drop",
                    "Templates preset: Alta Confiabilidade, Custo Minimo, Alta Qualidade",
                ],
                "tasks": [
                    {"title": "Diagrama de fluxo @xyflow/react", "rules": ["Nos por modelo com cor do provider", "Edges animados durante execucao", "Layout automatico Start → Chain → Error"]},
                    {"title": "Metricas em tempo real", "rules": ["Health dot por modelo", "Success rate, latencia, custo", "Polling a cada 30 segundos"]},
                    {"title": "Smart Reorder e Templates", "rules": ["4 estrategias de otimizacao", "3 templates preset", "Botao 'Optimize Order'"]},
                ]
            }
        ]
    },
    {
        "title": "Base de Conhecimento RAG",
        "context": "Sistema RAG (Retrieval-Augmented Generation) com embeddings 384-dim, busca semantica e indexacao continua de codigo e documentos.",
        "priority": "high",
        "story_points": 13,
        "semantic_map": {
            "N1": "RAGService",
            "N2": "rag_documents",
            "P1": "Store com embedding",
            "P2": "Retrieve por similaridade",
            "E1": "all-MiniLM-L6-v2",
            "D1": "pgvector cosine distance",
        },
        "labels": ["backend", "ai", "data"],
        "stories": [
            {
                "title": "Storage e Retrieval Semantico",
                "context": "Armazenamento de documentos com embeddings vetoriais e busca por similaridade coseno.",
                "rules": [
                    "Embeddings 384-dim via all-MiniLM-L6-v2",
                    "PostgreSQL com pgvector para busca vetorial",
                    "Metadata JSONB com indice GIN",
                    "Filtros por project_id, type, campos JSONB",
                    "Threshold de similaridade configuravel",
                ],
                "tasks": [
                    {"title": "Store com embedding automatico", "rules": ["Gerar embedding ao inserir", "Metadata JSONB flexivel", "project_id=None para conhecimento global"]},
                    {"title": "Retrieve por similaridade", "rules": ["Busca coseno via pgvector", "top_k e threshold configuraveis", "Filtros combinados com metadata"]},
                    {"title": "Business rules storage", "rules": ["Metadata: type, source, rule_type, priority", "Sources: interface, template, validation, model, code, document", "format_business_rules_for_prompt()"]},
                ]
            },
            {
                "title": "Indexacao Continua de Codigo",
                "context": "Scanner continuo que detecta mudancas no codigo e atualiza regras de negocio no RAG.",
                "rules": [
                    "ContinuousRAGService orquestra scan → delete → process",
                    "SHA-256 para detectar mudancas de arquivo",
                    "RAGFileState rastreia status: pending/processing/completed/failed",
                    "Classificacao semantica de camadas",
                    "Regras de interface tem prioridade maxima",
                ],
                "tasks": [
                    {"title": "Scanner de mudancas", "rules": ["Hash SHA-256 por arquivo", "Detectar arquivos novos/modificados/removidos", "Respeitar .gitignore e blocklist"]},
                    {"title": "Pipeline de processamento", "rules": ["Fila: scan → delete → process", "Classificar por semantic layer", "Extrair regras via IA"]},
                    {"title": "Indexacao de documentos satellite/docs/", "rules": ["Chunking: 500 chars com 50 overlap", "Tipo prompt_doc para documentacao", "Tipo business_rule para regras extraidas"]},
                ]
            },
            {
                "title": "Wiki Filesystem com RAG",
                "context": "Wiki armazenada como .md com YAML front matter em satellite/knowledge/wiki/, integrada ao RAG.",
                "rules": [
                    "Paginas .md com front matter YAML",
                    "Hierarquia via sistema de arquivos (pastas = filhos)",
                    "UUIDs deterministicos via uuid5(project_id:slug)",
                    "REGRA #0: manual/enrichment nunca sobrescrito por auto",
                    "Geracao automatica, enrichment e semantic links",
                ],
                "tasks": [
                    {"title": "CRUD de paginas wiki", "rules": ["read_page, write_page, delete_page, list_pages", "build_tree para hierarquia", "page_to_response para formato API"]},
                    {"title": "Geracao automatica de wiki", "rules": ["Gerar paginas a partir do contexto do projeto", "Regras de negocio como paginas filho", "Enrichment via IA"]},
                    {"title": "Semantic links entre paginas", "rules": ["Formato wiki:slug no conteudo", "apply_semantic_links() resolve links", "Links bidirecionais"]},
                ]
            }
        ]
    },
    {
        "title": "Kanban e Gestao Visual",
        "context": "Quadro Kanban com 6 colunas, drag-and-drop, painel de detalhes lateral e filtros avancados.",
        "priority": "high",
        "story_points": 13,
        "semantic_map": {
            "N1": "Quadro Kanban",
            "N2": "ItemDetailPanel",
            "P1": "Drag-and-drop entre colunas",
            "P2": "Painel lateral de detalhes",
            "D1": "6 colunas fixas",
        },
        "labels": ["frontend", "ui"],
        "stories": [
            {
                "title": "Quadro Kanban com 6 Colunas",
                "context": "Board visual com colunas: Bloqueado, Backlog, A Fazer, Em Progresso, Revisao, Concluido.",
                "rules": [
                    "6 colunas: blocked, backlog, todo, in_progress, review, done",
                    "Cards arrastados entre colunas",
                    "Contagem de cards por coluna",
                    "Sincronizacao com status do card",
                ],
                "tasks": [
                    {"title": "Layout de colunas responsivo", "rules": ["6 colunas side-by-side", "Scroll horizontal em telas menores", "Contagem de cards no header"]},
                    {"title": "Drag-and-drop de cards", "rules": ["Arrastar entre colunas", "Atualizar status automaticamente", "Animacao suave de transicao"]},
                    {"title": "Filtros do Kanban", "rules": ["Filtrar por item_type", "Filtrar por prioridade", "Busca por texto no titulo"]},
                ]
            },
            {
                "title": "Painel de Detalhes do Item",
                "context": "Painel lateral que abre ao clicar num card, mostrando todas as informacoes detalhadas.",
                "rules": [
                    "Abas: Overview, Prompt, Criterios, Entrevista",
                    "Edicao inline da descricao (double-click)",
                    "Rich Text Markdown toolbar",
                    "Criterios de aceitacao editaveis individualmente",
                    "Sincronizacao em tempo real com lista de tasks",
                ],
                "tasks": [
                    {"title": "Abas de conteudo", "rules": ["Overview: descricao human-readable", "Prompt: generated_prompt semantico", "Criterios: lista editavel", "Entrevista: historico"]},
                    {"title": "Edicao inline com toolbar", "rules": ["Double-click ativa modo edicao", "Toolbar: Bold, Italic, Code, Headings, Lists", "Ctrl+B, Ctrl+I, Ctrl+Enter, Esc"]},
                    {"title": "CRUD de criterios de aceitacao", "rules": ["Adicionar, editar, remover criterios", "Checkbox de completado", "Persistencia via API"]},
                ]
            }
        ]
    },
    {
        "title": "Satellite - Base de Conhecimento por Projeto",
        "context": "Estrutura de pastas satellite/ dentro do code_path do projeto para armazenar memoria, documentos, wiki, prompts e resultados.",
        "priority": "medium",
        "story_points": 8,
        "semantic_map": {
            "N1": "satellite/",
            "N2": "OrbitFolderService",
            "P1": "ensure_satellite_dirs()",
            "D1": "Estrutura: memory/, docs/, knowledge/",
        },
        "labels": ["backend", "infrastructure"],
        "stories": [
            {
                "title": "Estrutura de Pastas Satellite",
                "context": "Criacao e gerenciamento da pasta satellite/ com subpastas memory, docs, knowledge (wiki, results, prompts).",
                "rules": [
                    "satellite/memory/ - logs de execucao IA",
                    "satellite/docs/ - documentos externos vigiados pelo RAG",
                    "satellite/knowledge/wiki/ - wiki pages .md",
                    "satellite/knowledge/results/ - resultados do Claude Code",
                    "satellite/knowledge/prompts/ - prompts exportados",
                ],
                "tasks": [
                    {"title": "Criacao automatica de estrutura", "rules": ["ensure_satellite_dirs() idempotente", "Criar .gitkeep em cada subpasta", "Chamar na criacao de projeto"]},
                    {"title": "Export de prompts para satellite", "rules": ["Gerar .md com YAML front matter", "orbit_card_id no front matter", "Resultado esperado: _RESULT.md"]},
                    {"title": "Upload de documentos para docs/", "rules": ["Sanitizar filename contra path traversal", "Indexar automaticamente no RAG", "Listar e deletar via API"]},
                ]
            },
            {
                "title": "Deteccao e Processamento de Resultados",
                "context": "Scan de satellite/knowledge/results/ para detectar arquivos _RESULT.md e vincular ao card correspondente.",
                "rules": [
                    "Scan por padrao *_RESULT.md",
                    "orbit_card_id no front matter YAML",
                    "Criar/atualizar TaskResult",
                    "Mover card para status REVIEW",
                ],
                "tasks": [
                    {"title": "Scanner de resultados", "rules": ["Glob *_RESULT.md no diretorio results/", "Parse YAML front matter", "Vincular por orbit_card_id"]},
                    {"title": "Processamento de resultado", "rules": ["Criar TaskResult com output_code", "Atualizar status do card para REVIEW", "Registrar file_path e model_used"]},
                ]
            }
        ]
    },
    {
        "title": "Fila de Trabalho e Jobs em Background",
        "context": "Sistema de filas para processamento assincrono de tarefas de IA com controle de prioridade, paralelismo e rate limiting.",
        "priority": "medium",
        "story_points": 8,
        "semantic_map": {
            "N1": "Job Queue",
            "N2": "Background Worker",
            "P1": "Enfileirar e processar",
            "D1": "Rate limiting por modelo",
            "AC1": "Notificacoes de conclusao",
        },
        "labels": ["backend", "infrastructure"],
        "stories": [
            {
                "title": "Gerenciamento de Fila de Jobs",
                "context": "Fila de processamento com estrategias de ordenacao, reordenacao manual e controle de paralelismo.",
                "rules": [
                    "Estrategias: prioridade, hierarquia, dependencias, balanceada",
                    "Reordenacao manual de itens na fila",
                    "Pular itens especificos",
                    "Paralelismo configuravel",
                    "Preempcao de jobs criticos",
                ],
                "tasks": [
                    {"title": "Estrategias de ordenacao", "rules": ["4 estrategias configuraveis", "Ordenacao por prioridade como padrao", "Hierarquia respeita parent antes de child"]},
                    {"title": "Rate limiting por modelo", "rules": ["Limite de requisicoes por minuto", "Timeout maximo por requisicao", "Maximo de requisicoes simultaneas"]},
                    {"title": "Notificacoes de conclusao", "rules": ["Sino na barra superior", "Processo concluido, novos itens, falhas", "WebSocket para tempo real"]},
                ]
            }
        ]
    },
    {
        "title": "Dashboard e Monitoramento",
        "context": "Telas de monitoramento: dashboard de custos, console de logs, RAG analytics e configuracoes.",
        "priority": "medium",
        "story_points": 8,
        "semantic_map": {
            "N1": "Dashboard",
            "N2": "Console",
            "P1": "Monitoramento de custos",
            "P2": "Logs em tempo real",
            "D1": "Metricas por provider",
        },
        "labels": ["frontend", "ui"],
        "stories": [
            {
                "title": "Dashboard de Custos e Desempenho",
                "context": "Panorama geral do sistema com custos de IA, distribuicao por provider e desempenho do cache.",
                "rules": [
                    "Custo total das chamadas de IA",
                    "Distribuicao por provedor e operacao",
                    "Desempenho do cache (economia)",
                    "Graficos e metricas visuais",
                ],
                "tasks": [
                    {"title": "Cards de metricas principais", "rules": ["Custo total, economia do cache", "Calls totais, hit rate", "Cards estilizados com cores"]},
                    {"title": "Graficos de distribuicao", "rules": ["Custo por provider", "Custo por operacao", "Timeline de gastos"]},
                ]
            },
            {
                "title": "Console de Logs em Tempo Real",
                "context": "Visualizador de logs com filtros por categoria, nivel de severidade e busca por texto.",
                "rules": [
                    "Logs de chamadas de IA em tempo real",
                    "Filtro por categoria e severidade",
                    "Busca por texto",
                    "Auto-scroll e pause",
                ],
                "tasks": [
                    {"title": "Stream de logs", "rules": ["WebSocket para tempo real", "Auto-scroll para novos logs", "Pause/resume do stream"]},
                    {"title": "Filtros e busca", "rules": ["Filtrar por categoria: ai, rag, job, error", "Filtrar por severidade: info, warning, error", "Busca por texto livre"]},
                ]
            }
        ]
    },
]


def insert_card(db, card: dict):
    """Insert a single card into the tasks table."""
    sql = text("""
        INSERT INTO tasks (
            id, project_id, parent_id, item_type, title, description,
            generated_prompt, acceptance_criteria, story_points, priority,
            status, "column", "order", labels, workflow_state, reporter,
            description_edited_by, prompt_edited_by, interview_insights,
            components, comments, depends_on, status_history,
            interview_question_ids, generation_context,
            created_at, updated_at
        ) VALUES (
            :id, :project_id, :parent_id, :item_type, :title, :description,
            :generated_prompt, :acceptance_criteria, :story_points, :priority,
            :status, :column, :order, :labels, :workflow_state, :reporter,
            :description_edited_by, :prompt_edited_by, :interview_insights,
            :components, :comments, :depends_on, :status_history,
            :interview_question_ids, :generation_context,
            :created_at, :updated_at
        )
    """)
    db.execute(sql, card)


def main():
    logger.info("=" * 60)
    logger.info("Card Hierarchy Generator from RAG Business Rules")
    logger.info("=" * 60)

    db = SessionLocal()

    try:
        total_epics = 0
        total_stories = 0
        total_tasks = 0

        for epic_idx, epic_def in enumerate(HIERARCHY):
            # Create EPIC
            epic_sm = epic_def["semantic_map"]
            epic_rules = []
            for s in epic_def["stories"]:
                epic_rules.extend(s["rules"])

            epic = make_card(
                project_id=PROJECT_ID,
                parent_id=None,
                item_type="epic",
                title=epic_def["title"],
                description=render_description(epic_def["title"], epic_def["context"], epic_rules[:6], "Epic"),
                generated_prompt=render_prompt(epic_def["title"], epic_sm, epic_rules[:10], "EPIC"),
                acceptance_criteria=make_acceptance_criteria(epic_rules[:6]),
                story_points=epic_def["story_points"],
                priority=epic_def["priority"],
                order=epic_idx,
                labels=epic_def["labels"],
                semantic_map=epic_sm,
            )
            insert_card(db, epic)
            total_epics += 1
            logger.info(f"EPIC {epic_idx}: {epic_def['title']}")

            for story_idx, story_def in enumerate(epic_def["stories"]):
                # Create STORY
                story_sm = {**epic_sm, f"S{story_idx+1}": story_def["title"]}
                story = make_card(
                    project_id=PROJECT_ID,
                    parent_id=epic["id"],
                    item_type="story",
                    title=story_def["title"],
                    description=render_description(story_def["title"], story_def["context"], story_def["rules"], "Story"),
                    generated_prompt=render_prompt(story_def["title"], story_sm, story_def["rules"], "STORY"),
                    acceptance_criteria=make_acceptance_criteria(story_def["rules"]),
                    story_points=8 if epic_def["priority"] == "critical" else 5,
                    priority=epic_def["priority"],
                    order=story_idx,
                    labels=epic_def["labels"],
                    semantic_map=story_sm,
                    derived_from=epic["id"],
                )
                insert_card(db, story)
                total_stories += 1
                logger.info(f"  STORY {story_idx}: {story_def['title']}")

                for task_idx, task_def in enumerate(story_def.get("tasks", [])):
                    # Create TASK
                    task_sm = {**story_sm, f"T{task_idx+1}": task_def["title"]}
                    task = make_card(
                        project_id=PROJECT_ID,
                        parent_id=story["id"],
                        item_type="task",
                        title=task_def["title"],
                        description=render_description(task_def["title"], story_def["context"], task_def["rules"], "Task"),
                        generated_prompt=render_prompt(task_def["title"], task_sm, task_def["rules"], "TASK"),
                        acceptance_criteria=make_acceptance_criteria(task_def["rules"]),
                        story_points=3,
                        priority="medium",
                        order=task_idx,
                        labels=epic_def["labels"],
                        semantic_map=task_sm,
                        derived_from=story["id"],
                    )
                    insert_card(db, task)
                    total_tasks += 1

                logger.info(f"    {len(story_def.get('tasks', []))} tasks")

        db.commit()

        logger.info("\n" + "=" * 60)
        logger.info("SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Epics:    {total_epics}")
        logger.info(f"Stories:  {total_stories}")
        logger.info(f"Tasks:    {total_tasks}")
        logger.info(f"TOTAL:    {total_epics + total_stories + total_tasks}")

    except Exception as e:
        db.rollback()
        logger.error(f"Error: {e}")
        raise
    finally:
        db.close()

    logger.info("\nDone!")


if __name__ == "__main__":
    main()
