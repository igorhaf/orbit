"""
AI Flow Chain API Router
PROMPT #122 - AI Flow: Visual Fallback Chain Configuration
PROMPT #124 - Metrics, Animation, Analytics & Smart Reorder

CRUD operations for managing per-usage_type AI model fallback chains,
plus analytics, metrics, and smart optimization endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func, case, and_
from typing import List, Optional
from datetime import datetime, timedelta
from uuid import uuid4, UUID

from app.database import get_db
from app.models.ai_model import AIModel, AIModelUsageType
from app.models.ai_flow_chain import AIFlowChain
from app.models.ai_execution import AIExecution
from app.utils.pricing import calculate_cost, get_model_pricing
from app.models.ai_flow_profile import AIFlowProfile
from app.schemas.ai_flow_chain import (
    AIFlowChainBase,
    AIFlowChainCreate,
    AIFlowChainResponse,
    AIFlowChainWithModels,
    ModelMetrics,
    ModelMetricsResponse,
    ChainModelStats,
    ChainAnalyticsItem,
    ChainAnalyticsResponse,
    OptimizeChainRequest,
    OptimizeChainResponse,
    OptimizeModelScore,
    ChainTemplate,
    ChainTemplatesResponse,
    UTILITY_NODE_TYPES,
    AIFlowProfileCreate,
    AIFlowProfileUpdate,
    AIFlowProfileResponse,
)

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# v3.0 Canvas Snapshot — full project view for the unified AI Studio canvas
# ============================================================================

# Deep Pipeline phase catalog (mirrors what runs in deep_pipeline/service.py).
# Each entry: (phase_key, label, default_model_id, description).
DEEP_PIPELINE_PHASES = [
    ("phase_0",  "Phase 0 — Structural scan",      None,                 "Filesystem scan (sem AI)"),
    ("phase_1",  "Phase 1 — File analysis",        "claude-haiku-4-5",   "Análise per-file batched"),
    ("phase_2",  "Phase 2 — Rule synthesis",       "claude-sonnet-4-6",  "Síntese cross-file por domínio"),
    ("phase_3",  "Phase 3 — Architectural map",    "claude-sonnet-4-6",  "Mapa arquitetural (extended thinking)"),
    ("phase_4a", "Phase 4a — Epics",               "claude-opus-4-7",    "Geração de Epics por domínio"),
    ("phase_4b", "Phase 4b — Stories",             "claude-opus-4-7",    "Decomposição em Stories"),
    ("phase_4c", "Phase 4c — Tasks",               "claude-sonnet-4-6",  "Decomposição em Tasks"),
    ("phase_5",  "Phase 5 — Wiki",                 "claude-sonnet-4-6",  "Wiki multi-page (overview/domínio/fluxos)"),
    ("phase_6",  "Phase 6 — QA",                   "claude-sonnet-4-6",  "Quality assurance (extended thinking)"),
]



# v3.1 — Deep Pipeline grouped into 4 logical subflows for the canvas root.
DEEP_PIPELINE_GROUPS = [
    {"id": "discovery", "label": "Discovery",
     "phase_keys": ["phase_0", "phase_1", "phase_2", "phase_3"], "order": 0},
    {"id": "cards",     "label": "Cards",
     "phase_keys": ["phase_4a", "phase_4b", "phase_4c"], "order": 1},
    {"id": "wiki",      "label": "Wiki",
     "phase_keys": ["phase_5"], "order": 2},
    {"id": "qa",        "label": "QA",
     "phase_keys": ["phase_6"], "order": 3},
]


# ────────────────────────────────────────────────────────────────────────────
# v3.5 — DEEP_PIPELINE_HIERARCHY (3 níveis aninhados)
#
# Mapa completo da arquitetura ideal do Deep Pipeline pra render no canvas:
#  - Nível 1 (root): 4 áreas executáveis (Discovery, Cards, Wiki, QA)
#  - Nível 2: sub-subflows (Phase0_Scan, Phase1_FileAnalysis, Phase4a_Epics...)
#  - Nível 3: cada sub-subflow contém uma cadeia de utility nodes + ioNodes
#    Entrada/Saída + (opcionalmente) modelNode.
#
# Cada step nível 3 é uma tupla:
#   (kind, opts?)  ─ kind é o `kind` do catálogo (file_scanner, etc) ou
#                    "model:<model_id>" para um modelNode da phase;
#                    opts é um dict de config override + flag `planned`.
#
# Esta estrutura É a "arquitetura ideal" que a Entrega B (engine) vai
# executar. Itens marcados com {"planned": True} ainda não rodam no código
# atual mas a Entrega B vai introduzir.
# ────────────────────────────────────────────────────────────────────────────
DEEP_PIPELINE_HIERARCHY = [
    {
        "id": "discovery", "label": "Discovery", "order": 0,
        "children": [
            {"id": "phase_0_scan", "label": "Phase 0 — Scan", "phase_key": "phase_0",
             "steps": [
                 ("file_scanner", {}),
                 ("file_type_classifier", {}),
                 # v3.5.2: switch por file_type — skip semantic_layer pra test/migration/config
                 ("switch", {"config": {"selector": "$.file_type",
                                        "cases": ["test", "migration", "config", "vendor"]},
                             "planned": True}),
                 ("semantic_layer_classifier", {}),
                 ("change_detector", {"planned": True}),
                 # v3.5.2: if_else — só gravar artifact se houve mudanças
                 ("if_else", {"config": {"condition": "$.has_changes"}, "planned": True}),
                 ("pipeline_artifact_writer", {"planned": True}),
             ]},
            {"id": "phase_1_file_analysis", "label": "Phase 1 — File Analysis", "phase_key": "phase_1",
             "steps": [
                 ("file_scanner", {}),
                 # v3.5.2: for_each por arquivo (já é batched, explicita o loop)
                 ("for_each", {"config": {"collection_path": "$.files", "item_var": "file"},
                               "planned": True}),
                 ("content_truncator", {}),
                 ("spec_loader", {"planned": True}),
                 ("spec_relevance_filter", {"planned": True}),
                 ("contract_renderer", {"config": {"contract_name": "deep_file_analysis"}}),
                 ("model_selector", {}),
                 ("quota_probe", {}),
                 ("provider_health_check", {}),
                 # v3.5.2: AND — só chama claudius se quota AND health OK
                 ("logical_and", {"config": {"inputs": ["quota.available", "health.healthy"]},
                                  "planned": True}),
                 ("model:claude-haiku-4-5", {"call_kind": "batch"}),
                 ("json_extractor", {}),
                 ("json_schema_validator", {"planned": True}),
                 # v3.5.2: AND — só persistir se extract OK AND schema valid
                 ("logical_and", {"config": {"inputs": ["json_extractor.success", "schema_validator.valid"]},
                                  "planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("checkpoint_saver", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_2_rule_synthesis", "label": "Phase 2 — Rule Synthesis", "phase_key": "phase_2",
             "steps": [
                 ("domain_grouper", {}),
                 # v3.5.2: for_each por domain (síntese é per-domain)
                 ("for_each", {"config": {"collection_path": "$.domains", "item_var": "domain"},
                               "planned": True}),
                 ("json_compactor", {}),
                 ("spec_loader", {"planned": True}),
                 ("spec_relevance_filter", {"planned": True}),
                 # v3.5.2: if_else — só inclui specs no prompt se há match relevante
                 ("if_else", {"config": {"condition": "$.relevant_specs.length > 0"},
                              "planned": True}),
                 ("contract_renderer", {"config": {"contract_name": "deep_rule_synthesis"}}),
                 ("model_selector", {}),
                 ("quota_probe", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "single", "multi_turn": True}),
                 ("json_extractor", {}),
                 ("json_schema_validator", {"planned": True}),
                 ("business_rule_storer", {}),
                 ("embed_and_store", {"planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_3_arch_map", "label": "Phase 3 — Architectural Map", "phase_key": "phase_3",
             "steps": [
                 ("json_compactor", {}),
                 ("contract_renderer", {"config": {"contract_name": "deep_architectural_map"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "single", "thinking_budget": 4000}),
                 ("json_extractor", {}),
                 # v3.5.2: if_else — se error, vai pro error_classifier; se ok, persiste
                 ("if_else", {"config": {"condition": "$.error_present"}, "planned": True}),
                 ("json_schema_validator", {"planned": True}),
                 ("error_classifier", {"planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("checkpoint_saver", {"planned": True}),
                 ("telemetry_emitter", {}),
             ]},
        ],
    },
    {
        "id": "cards", "label": "Cards", "order": 1,
        "children": [
            {"id": "phase_4a_epics", "label": "Phase 4a — Epics", "phase_key": "phase_4a",
             "steps": [
                 ("domain_grouper", {}),
                 # v3.5.2: for_each por domain
                 ("for_each", {"config": {"collection_path": "$.domains", "item_var": "domain"},
                               "planned": True}),
                 ("json_compactor", {}),
                 ("contract_renderer", {"config": {"contract_name": "deep_epic_generation"}}),
                 ("model_selector", {}),
                 ("quota_probe", {}),
                 ("model:claude-opus-4-7", {"call_kind": "batch", "max_concurrency": 20}),
                 ("json_extractor", {}),
                 ("epic_deduplicator", {}),
                 # v3.5.2: while — retry se epics < min_epics (max 2 iter — Opus é caro)
                 ("while_loop", {"config": {"condition": "$.epics.length < $.min_epics",
                                            "max_iter": 2}, "planned": True}),
                 ("card_hierarchy_builder", {"planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("checkpoint_saver", {"planned": True}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_4b_stories", "label": "Phase 4b — Stories", "phase_key": "phase_4b",
             "steps": [
                 # v3.5.2: for_each por epic (stories são per-epic)
                 ("for_each", {"config": {"collection_path": "$.epics", "item_var": "epic"},
                               "planned": True}),
                 ("json_compactor", {}),
                 ("prompt_context_compressor", {"planned": True}),
                 ("contract_renderer", {"config": {"contract_name": "deep_story_generation"}}),
                 ("model_selector", {}),
                 ("model:claude-opus-4-7", {"call_kind": "batch", "max_concurrency": 3}),
                 ("json_extractor", {}),
                 ("json_schema_validator", {"planned": True}),
                 # v3.5.2: NOT — respeitar story.human_edited (REGRA #0)
                 ("logical_not", {"config": {"input": "$.story.human_edited"}, "planned": True}),
                 ("card_hierarchy_builder", {}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("checkpoint_saver", {"planned": True}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_4c_tasks", "label": "Phase 4c — Tasks", "phase_key": "phase_4c",
             "steps": [
                 # v3.5.2: for_each por story
                 ("for_each", {"config": {"collection_path": "$.stories", "item_var": "story"},
                               "planned": True}),
                 ("json_compactor", {}),
                 ("prompt_context_compressor", {"planned": True}),
                 ("contract_renderer", {"config": {"contract_name": "deep_task_generation"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "batch", "max_concurrency": 5}),
                 ("json_extractor", {}),
                 ("json_schema_validator", {"planned": True}),
                 # v3.5.2: NOT — respeitar task.human_edited (REGRA #0)
                 ("logical_not", {"config": {"input": "$.task.human_edited"}, "planned": True}),
                 ("card_hierarchy_builder", {}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("checkpoint_saver", {"planned": True}),
                 ("telemetry_emitter", {}),
             ]},
        ],
    },
    {
        "id": "wiki", "label": "Wiki", "order": 2,
        "children": [
            {"id": "phase_5a_structure", "label": "Phase 5a — Structure", "phase_key": "phase_5",
             "steps": [
                 # Sem control flow — single call curto, sem loop nem decisão
                 ("json_compactor", {}),
                 ("contract_renderer", {"config": {"contract_name": "deep_wiki_structure"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "single"}),
                 ("json_extractor", {}),
                 ("json_schema_validator", {"planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_5b_overview", "label": "Phase 5b — Overview", "phase_key": "phase_5",
             "steps": [
                 ("json_compactor", {}),
                 ("contract_renderer", {"config": {"contract_name": "deep_wiki_overview"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "single", "max_tokens": 64000}),
                 ("json_extractor", {}),
                 ("wiki_page_writer", {}),
                 # v3.5.2: AND — embed só se página escrita E não-dryrun
                 ("logical_and", {"config": {"inputs": ["wiki_page_writer.success", "NOT $.is_dryrun"]},
                                  "planned": True}),
                 ("embed_and_store", {"planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_5c_domain_pages", "label": "Phase 5c — Domain Pages", "phase_key": "phase_5",
             "steps": [
                 ("domain_grouper", {}),
                 # v3.5.2: for_each por domain
                 ("for_each", {"config": {"collection_path": "$.domains", "item_var": "domain"},
                               "planned": True}),
                 ("json_compactor", {}),
                 ("prompt_context_compressor", {"planned": True}),
                 ("contract_renderer", {"config": {"contract_name": "deep_wiki_domain"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "batch", "max_concurrency": 3}),
                 ("json_extractor", {}),
                 # v3.5.2: if_else — só gravar+chunkar+embed se página tem conteúdo significativo
                 ("if_else", {"config": {"condition": "$.page.length > min_content_threshold"},
                              "planned": True}),
                 ("wiki_page_writer", {}),
                 ("text_chunker", {"planned": True}),
                 ("embed_and_store", {"planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_5d_flow_pages", "label": "Phase 5d — Flow Pages", "phase_key": "phase_5",
             "steps": [
                 # v3.5.2: if_else — só executa se há flow candidates (a step já é optional)
                 ("if_else", {"config": {"condition": "$.has_flow_candidates"},
                              "planned": True}),
                 ("json_compactor", {}),
                 ("contract_renderer", {"config": {"contract_name": "deep_wiki_flow"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "single", "optional": True}),
                 ("json_extractor", {}),
                 ("wiki_page_writer", {}),
                 ("embed_and_store", {"planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
        ],
    },
    {
        "id": "qa", "label": "QA", "order": 3,
        "children": [
            {"id": "phase_6_ai_qa", "label": "Phase 6 — AI QA", "phase_key": "phase_6",
             "steps": [
                 ("json_compactor", {}),
                 ("contract_renderer", {"config": {"contract_name": "deep_qa"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "single", "thinking_budget": 3000}),
                 ("json_extractor", {}),
                 ("json_schema_validator", {"planned": True}),
                 ("phase_score_calculator", {"planned": True}),
                 # v3.5.2: while — re-roda se quality_score < threshold (1 retry max)
                 ("while_loop", {"config": {"condition": "$.quality_score < $.threshold",
                                            "max_iter": 1}, "planned": True}),
                 ("error_classifier", {"planned": True}),
                 # v3.5.2: switch — roteia por error_kind (schema vs quota vs default)
                 ("switch", {"config": {"selector": "$.error_kind",
                                        "cases": ["schema", "quota", "rate_limit"]},
                             "planned": True}),
                 ("ai_execution_logger", {}),
                 ("token_cost_calculator", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_6_local_qa", "label": "Phase 6 — Local QA", "phase_key": "phase_6",
             "steps": [
                 # Sem control flow — 4 steps determinísticos
                 ("phase_score_calculator", {}),
                 ("local_qa", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "phase_7_gap_filling", "label": "Phase 7 — Gap Filling", "phase_key": "phase_7",
             "steps": [
                 ("error_classifier", {"planned": True}),
                 # v3.5.2: switch — roteia por gap_type pro phase certa de retomada
                 ("switch", {"config": {"selector": "$.gap_type",
                                        "cases": ["missing_epic", "missing_story",
                                                  "missing_task", "missing_wiki"]},
                             "planned": True}),
                 ("router", {"planned": True}),
                 ("job_child_creator", {"planned": True}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
            {"id": "post_enrich_project", "label": "Post — Enrich Project", "phase_key": "phase_7",
             "steps": [
                 ("git_commit_fetcher", {}),
                 ("rag_query", {}),
                 # v3.5.2: OR — só roda enrich se há commits novos OU hits RAG
                 ("logical_or", {"config": {"inputs": ["git.has_commits", "rag.has_hits"]},
                                 "planned": True}),
                 ("json_compactor", {}),
                 ("contract_renderer", {"config": {"contract_name": "deep_project_enrichment"}}),
                 ("model_selector", {}),
                 ("model:claude-sonnet-4-6", {"call_kind": "single"}),
                 ("json_extractor", {}),
                 ("pipeline_artifact_writer", {}),
                 ("telemetry_emitter", {}),
             ]},
        ],
    },
]


# Helper: catálogo de utility nodes por kind (lookup). Populado em
# `get_canvas_snapshot` quando o catalog_utilities é construído.
_UTILITY_CATALOG_BY_KIND: dict[str, dict] = {}


# ────────────────────────────────────────────────────────────────────────────
# v3.5 — Type system + node I/O schemas
#
# Cada `kind` declara `inputs[]` e `outputs[]` com (name, type). Tipos são
# strings simples; o tipo "Any" aceita qualquer coisa (escape hatch).
# A validação de conexão checa: source.outputs[handle].type matcha
# target.inputs[handle].type (ou Any em qualquer lado).
#
# Control-flow nodes têm múltiplas saídas com handles nomeados:
#   if_else:    [in: Any] → out: { true: Any, false: Any }
#   switch:     [in: Any] → out: { case_*: Any, default: Any }
#   for_each:   [in: List] → out: { body: T, done: Aggregate }
#   while_loop: [in: Any] → out: { body: Any, done: Any }
#   logical_and/or: [a: Bool, b: Bool] → out: Bool
#   logical_not: [in: Bool] → out: Bool
#
# Output expostos no snapshot.meta.types_schema pro frontend validar
# conexões antes mesmo do save.
# ────────────────────────────────────────────────────────────────────────────

# Tipos canônicos (string). 'Any' = aceita qualquer coisa.
TYPE_ANY = "Any"
TYPE_BOOL = "Boolean"
TYPE_STRING = "String"
TYPE_NUMBER = "Number"
TYPE_JSON = "JSON"
TYPE_FILE_LIST = "FileList"           # [{path, content, ...}]
TYPE_FILE = "File"                    # {path, content, ...}
TYPE_RAG_DOCS = "RAGDocs"             # [{content, similarity, ...}]
TYPE_RAG_DOC = "RAGDoc"
TYPE_PROMPT = "Prompt"                # {system, user, ...}
TYPE_AI_RESPONSE = "AIResponse"       # {text, thinking?, usage}
TYPE_DOMAIN_MAP = "DomainMap"         # {domain: [...]}
TYPE_EPIC_LIST = "EpicList"
TYPE_STORY_LIST = "StoryList"
TYPE_TASK_LIST = "TaskList"
TYPE_WIKI_PAGE = "WikiPage"
TYPE_ARTIFACT = "Artifact"            # PipelineArtifact row
TYPE_QA_RESULT = "QAResult"
TYPE_ERROR = "Error"
TYPE_SCORE = "Score"
TYPE_TOKEN_USAGE = "TokenUsage"
TYPE_QUOTA = "QuotaStatus"
TYPE_SPEC_LIST = "SpecList"
TYPE_COLLECTION = "Collection"        # generic List[T] for forEach
TYPE_PHASE_CONFIG = "PhaseConfig"


# Schema dos 44 utility nodes + control flow + model + io.
# Formato:
#   kind: {
#     "inputs":  [(name, type, required?), ...],
#     "outputs": [(name, type), ...]   ← name é o handle id na ReactFlow
#   }
NODE_IO_SCHEMA: dict[str, dict] = {
    # ── Discovery ────────────────────────────────────────────────────────
    "file_scanner":               {"inputs": [("project", TYPE_ANY, True)],
                                   "outputs": [("files", TYPE_FILE_LIST)]},
    "file_type_classifier":       {"inputs": [("files", TYPE_FILE_LIST, True)],
                                   "outputs": [("classified", TYPE_FILE_LIST)]},
    "semantic_layer_classifier":  {"inputs": [("files", TYPE_FILE_LIST, True)],
                                   "outputs": [("layered", TYPE_FILE_LIST)]},
    "change_detector":            {"inputs": [("files", TYPE_FILE_LIST, True), ("baseline", TYPE_JSON, False)],
                                   "outputs": [("diff", TYPE_JSON)]},
    # ── Processing ───────────────────────────────────────────────────────
    "content_truncator":          {"inputs": [("text", TYPE_STRING, True)],
                                   "outputs": [("truncated", TYPE_STRING)]},
    "json_compactor":             {"inputs": [("data", TYPE_JSON, True)],
                                   "outputs": [("compact", TYPE_STRING)]},
    "json_extractor":             {"inputs": [("text", TYPE_STRING, True)],
                                   "outputs": [("data", TYPE_JSON), ("error", TYPE_ERROR)]},
    "domain_grouper":             {"inputs": [("items", TYPE_JSON, True)],
                                   "outputs": [("by_domain", TYPE_DOMAIN_MAP)]},
    "epic_deduplicator":          {"inputs": [("epics", TYPE_EPIC_LIST, True)],
                                   "outputs": [("epics", TYPE_EPIC_LIST), ("removed", TYPE_NUMBER)]},
    "card_hierarchy_builder":     {"inputs": [("cards", TYPE_JSON, True)],
                                   "outputs": [("hierarchy", TYPE_JSON)]},
    "text_chunker":               {"inputs": [("text", TYPE_STRING, True)],
                                   "outputs": [("chunks", TYPE_COLLECTION)]},
    "git_commit_fetcher":         {"inputs": [("project", TYPE_ANY, True)],
                                   "outputs": [("commits", TYPE_JSON)]},
    "prompt_context_compressor":  {"inputs": [("context", TYPE_JSON, True)],
                                   "outputs": [("compressed", TYPE_JSON)]},
    # ── Storage / RAG ────────────────────────────────────────────────────
    "embed_and_store":            {"inputs": [("content", TYPE_STRING, True), ("metadata", TYPE_JSON, False)],
                                   "outputs": [("doc_id", TYPE_STRING)]},
    "rag_query":                  {"inputs": [("query", TYPE_STRING, True)],
                                   "outputs": [("docs", TYPE_RAG_DOCS)]},
    "business_rule_storer":       {"inputs": [("rule", TYPE_STRING, True), ("metadata", TYPE_JSON, False)],
                                   "outputs": [("doc_id", TYPE_STRING)]},
    "pipeline_artifact_writer":   {"inputs": [("content", TYPE_JSON, True)],
                                   "outputs": [("artifact", TYPE_ARTIFACT)]},
    "wiki_page_writer":           {"inputs": [("page", TYPE_JSON, True)],
                                   "outputs": [("page", TYPE_WIKI_PAGE)]},
    "checkpoint_saver":           {"inputs": [("state", TYPE_JSON, True)],
                                   "outputs": [("saved", TYPE_BOOL)]},
    # ── AI ───────────────────────────────────────────────────────────────
    "claudius_single_call":       {"inputs": [("prompt", TYPE_PROMPT, True)],
                                   "outputs": [("response", TYPE_AI_RESPONSE), ("error", TYPE_ERROR)]},
    "claudius_batch_call":        {"inputs": [("prompts", TYPE_COLLECTION, True)],
                                   "outputs": [("responses", TYPE_COLLECTION), ("errors", TYPE_COLLECTION)]},
    "quota_probe":                {"inputs": [],
                                   "outputs": [("status", TYPE_QUOTA), ("available", TYPE_BOOL)]},
    "provider_health_check":      {"inputs": [],
                                   "outputs": [("healthy", TYPE_BOOL)]},
    "model_selector":             {"inputs": [("usage_type", TYPE_STRING, False)],
                                   "outputs": [("model", TYPE_STRING)]},
    "token_cost_calculator":      {"inputs": [("usage", TYPE_TOKEN_USAGE, True)],
                                   "outputs": [("cost", TYPE_NUMBER)]},
    "ai_execution_logger":        {"inputs": [("call", TYPE_AI_RESPONSE, True)],
                                   "outputs": [("logged", TYPE_BOOL)]},
    # ── Specs ────────────────────────────────────────────────────────────
    "spec_loader":                {"inputs": [("project", TYPE_ANY, True)],
                                   "outputs": [("specs", TYPE_SPEC_LIST)]},
    "spec_relevance_filter":      {"inputs": [("specs", TYPE_SPEC_LIST, True), ("keywords", TYPE_COLLECTION, False)],
                                   "outputs": [("filtered", TYPE_SPEC_LIST)]},
    "contract_renderer":          {"inputs": [("vars", TYPE_JSON, True)],
                                   "outputs": [("prompt", TYPE_PROMPT)]},
    # ── Validation ───────────────────────────────────────────────────────
    "json_schema_validator":      {"inputs": [("data", TYPE_JSON, True)],
                                   "outputs": [("valid", TYPE_BOOL), ("errors", TYPE_COLLECTION)]},
    "local_qa":                   {"inputs": [("artifacts", TYPE_JSON, True)],
                                   "outputs": [("result", TYPE_QA_RESULT)]},
    "error_classifier":           {"inputs": [("error", TYPE_ERROR, True)],
                                   "outputs": [("kind", TYPE_STRING)]},
    "phase_score_calculator":     {"inputs": [("phase_data", TYPE_JSON, True)],
                                   "outputs": [("score", TYPE_SCORE)]},
    # ── Observability ────────────────────────────────────────────────────
    "telemetry_emitter":          {"inputs": [("event", TYPE_JSON, True)],
                                   "outputs": [("emitted", TYPE_BOOL)]},
    "job_child_creator":          {"inputs": [("parent_job", TYPE_ANY, True), ("payload", TYPE_JSON, True)],
                                   "outputs": [("job_id", TYPE_STRING)]},
    # ── Legacy ───────────────────────────────────────────────────────────
    "cache":                      {"inputs": [("key", TYPE_STRING, True)],
                                   "outputs": [("hit", TYPE_BOOL), ("value", TYPE_ANY)]},
    "rag_context":                {"inputs": [("query", TYPE_STRING, True)],
                                   "outputs": [("context", TYPE_STRING)]},
    "router":                     {"inputs": [("payload", TYPE_ANY, True)],
                                   "outputs": [("route", TYPE_STRING)]},
    "retry":                      {"inputs": [("operation", TYPE_ANY, True)],
                                   "outputs": [("result", TYPE_ANY), ("error", TYPE_ERROR)]},
    "validator":                  {"inputs": [("payload", TYPE_ANY, True)],
                                   "outputs": [("valid", TYPE_BOOL)]},
    "cost_guard":                 {"inputs": [("cost", TYPE_NUMBER, True)],
                                   "outputs": [("allowed", TYPE_BOOL)]},
    "rate_limiter":               {"inputs": [("request", TYPE_ANY, True)],
                                   "outputs": [("allowed", TYPE_BOOL)]},
    "timeout":                    {"inputs": [("operation", TYPE_ANY, True)],
                                   "outputs": [("result", TYPE_ANY), ("timed_out", TYPE_BOOL)]},
    "prompt_transformer":         {"inputs": [("prompt", TYPE_PROMPT, True)],
                                   "outputs": [("prompt", TYPE_PROMPT)]},

    # ── v3.5 — Control flow (multi-output handles) ───────────────────────
    "if_else": {
        "inputs":  [("input", TYPE_ANY, True), ("condition", TYPE_STRING, False)],
        "outputs": [("true", TYPE_ANY), ("false", TYPE_ANY)],
    },
    "switch": {
        # cases declared in node.data.config.cases: ["case_a", "case_b", ...]
        "inputs":  [("input", TYPE_ANY, True), ("selector", TYPE_STRING, False)],
        "outputs": [("default", TYPE_ANY)],  # extras vão dinâmicos
        "dynamic_outputs": True,
    },
    "for_each": {
        "inputs":  [("collection", TYPE_COLLECTION, True)],
        "outputs": [("body", TYPE_ANY), ("done", TYPE_COLLECTION)],
    },
    "while_loop": {
        "inputs":  [("state", TYPE_ANY, True), ("condition", TYPE_STRING, False)],
        "outputs": [("body", TYPE_ANY), ("done", TYPE_ANY)],
    },
    "logical_and": {
        "inputs":  [("a", TYPE_BOOL, True), ("b", TYPE_BOOL, True)],
        "outputs": [("result", TYPE_BOOL)],
    },
    "logical_or": {
        "inputs":  [("a", TYPE_BOOL, True), ("b", TYPE_BOOL, True)],
        "outputs": [("result", TYPE_BOOL)],
    },
    "logical_not": {
        "inputs":  [("input", TYPE_BOOL, True)],
        "outputs": [("result", TYPE_BOOL)],
    },

    # ── Container nodes ──────────────────────────────────────────────────
    # ioNode = Entrada/Saída de um subflow. Aceita/produz Any.
    # Direção (input vs output) é dada por data.io_kind.
    "io_input":   {"inputs": [],
                   "outputs": [("payload", TYPE_ANY)]},
    "io_output":  {"inputs": [("payload", TYPE_ANY, True)],
                   "outputs": []},
    # modelNode = chamada AI. Recebe prompt, produz response.
    "model":      {"inputs": [("prompt", TYPE_PROMPT, True)],
                   "outputs": [("response", TYPE_AI_RESPONSE), ("error", TYPE_ERROR)]},
}


def _schema_for(kind: str) -> dict:
    """Resolve I/O schema for a node kind. Returns Any-Any defaults for unknown."""
    if kind in NODE_IO_SCHEMA:
        return NODE_IO_SCHEMA[kind]
    return {
        "inputs":  [("input", TYPE_ANY, True)],
        "outputs": [("output", TYPE_ANY)],
    }


def _schema_to_dict(schema: dict) -> dict:
    """Convert tuple-list schema to JSON-friendly dict for the frontend."""
    inputs = []
    for spec in schema.get("inputs", []):
        name, ttype = spec[0], spec[1]
        required = spec[2] if len(spec) > 2 else True
        inputs.append({"name": name, "type": ttype, "required": required})
    outputs = []
    for spec in schema.get("outputs", []):
        outputs.append({"name": spec[0], "type": spec[1]})
    return {
        "inputs": inputs,
        "outputs": outputs,
        "dynamic_outputs": bool(schema.get("dynamic_outputs", False)),
    }


def _merge_phase_configs(profile_phase_configs: dict, fallback_phases: list) -> dict:
    """Merge a pipeline_profile.phase_configs jsonb with the DEEP_PIPELINE_PHASES
    fallback so the snapshot always renders every phase, even if the profile
    doesn't cover all of them."""
    merged: dict = {}
    # v3.4: skip reserved keys (e.g. __canvas_graph__) used to piggy-back
    # arbitrary JSON inside phase_configs JSONB.
    safe_profile_cfg = {
        k: v for k, v in (profile_phase_configs or {}).items()
        if not (isinstance(k, str) and k.startswith("__"))
    }
    for key, label, default_model, description in fallback_phases:
        entry = {
            "label": label,
            "description": description,
            "model": default_model,
        }
        if safe_profile_cfg and key in safe_profile_cfg:
            user_cfg = safe_profile_cfg[key] or {}
            if isinstance(user_cfg, dict):
                entry.update(user_cfg)
                # If profile sets model, prefer that
                if user_cfg.get("model"):
                    entry["model"] = user_cfg["model"]
        merged[key] = entry
    return merged


@router.get("/canvas-snapshot")
async def get_canvas_snapshot(db: Session = Depends(get_db)):
    """Return the full project's AI configuration as a ReactFlow-compatible
    snapshot for the v3.1 unified canvas.

    Root tab "Canvas" shows:
      - 4 SubflowNodes (Discovery → Cards → Wiki → QA), wired sequentially
      - 10 ModelNodes (3 columns: Opus / Sonnet / Haiku) with usage_type badges
      - Edges between consecutive subflows in canonical order

    Each subflow exposes its phase nodes when opened in a tab on the frontend.
    The canvas IS the Deep Pipeline — there's no separate "Deep Pipeline" subflow.
    Other chains (interview, prompt_generation, ...) appear as badges on
    ModelNodes — no extra subflows for single-model chains.
    """
    from app.models.ai_model import AIModel
    from app.models.ai_flow_chain import AIFlowChain
    from app.models.pipeline_profile import PipelineProfile

    models = db.query(AIModel).filter(AIModel.is_active == True).all()
    chains = db.query(AIFlowChain).filter(AIFlowChain.is_active == True).all()
    # Default pipeline profile (canvas-owned). Falls back to DEEP_PIPELINE_PHASES.
    profile = (
        db.query(PipelineProfile)
        .filter(PipelineProfile.is_default == True)
        .first()
    )
    profile_phase_configs = (profile.phase_configs if profile else {}) or {}
    phase_catalog = _merge_phase_configs(profile_phase_configs, DEEP_PIPELINE_PHASES)

    # Build usage_type → list of model_ids (chain[0] is the primary)
    usage_to_model_pks: dict[str, list[str]] = {}
    for ch in chains:
        usage = ch.usage_type.value if hasattr(ch.usage_type, "value") else str(ch.usage_type)
        usage_to_model_pks[usage] = [str(mid) for mid in (ch.chain or [])]
    model_pk_to_usages: dict[str, list[str]] = {}
    for usage, pks in usage_to_model_pks.items():
        for pk in pks:
            model_pk_to_usages.setdefault(pk, []).append(usage)

    nodes: list[dict] = []
    edges: list[dict] = []
    subflows: dict[str, dict] = {}

    # Build a lookup of AIModel by model_id (config.model_id) so each phase
    # can resolve its assigned model to a label/PK for the inner ModelNode.
    model_by_id: dict[str, "AIModel"] = {}
    for m in models:
        mid = (m.config or {}).get("model_id")
        if mid and mid not in model_by_id:
            model_by_id[mid] = m

    # Defaults visuais por categoria (usado pra preencher utility nodes da
    # hierarquia quando o catalog completo ainda não foi materializado).
    # Match os valores em catalog_utilities mais abaixo.
    _CAT_DEFAULTS: dict[str, tuple[str, str]] = {
        "Discovery":      ("#0891b2", "folder-search"),
        "Processing":     ("#f59e0b", "edit"),
        "Storage":        ("#8b5cf6", "database-zap"),
        "AI":             ("#7c3aed", "sparkles"),
        "Specs":          ("#0ea5e9", "file-text"),
        "Validation":     ("#22c55e", "shield-check"),
        "Observability":  ("#64748b", "activity"),
        "Resilience":     ("#3b82f6", "repeat"),
        "Routing":        ("#10b981", "git-fork"),
        "ControlFlow":    ("#dc2626", "git-branch"),
    }
    # Map kind → (label, category) baseado no catalog_utilities. Sincronizar
    # com a lista abaixo se adicionar kinds novos.
    _KIND_META: dict[str, tuple[str, str]] = {
        # Discovery
        "file_scanner":               ("File Scanner",              "Discovery"),
        "file_type_classifier":       ("File Type Classifier",      "Discovery"),
        "semantic_layer_classifier":  ("Semantic Layer",            "Discovery"),
        "change_detector":            ("Change Detector",           "Discovery"),
        # Processing
        "content_truncator":          ("Content Truncator",         "Processing"),
        "json_compactor":             ("JSON Compactor",            "Processing"),
        "json_extractor":             ("JSON Extractor",            "Processing"),
        "domain_grouper":             ("Domain Grouper",            "Processing"),
        "epic_deduplicator":          ("Epic Deduplicator",         "Processing"),
        "card_hierarchy_builder":     ("Card Hierarchy",            "Processing"),
        "text_chunker":               ("Text Chunker",              "Processing"),
        "git_commit_fetcher":         ("Git Commit Fetcher",        "Processing"),
        "prompt_context_compressor":  ("Context Compressor",        "Processing"),
        # Storage
        "embed_and_store":            ("Embed & Store",             "Storage"),
        "rag_query":                  ("RAG Query",                 "Storage"),
        "business_rule_storer":       ("Business Rule Storer",      "Storage"),
        "pipeline_artifact_writer":   ("Artifact Writer",           "Storage"),
        "wiki_page_writer":           ("Wiki Page Writer",          "Storage"),
        "checkpoint_saver":           ("Checkpoint Saver",          "Storage"),
        # AI
        "claudius_single_call":       ("Claudius Call",             "AI"),
        "claudius_batch_call":        ("Claudius Batch",            "AI"),
        "quota_probe":                ("Quota Probe",               "AI"),
        "provider_health_check":      ("Health Check",              "AI"),
        "model_selector":             ("Model Selector",            "AI"),
        "token_cost_calculator":      ("Token Cost",                "AI"),
        "ai_execution_logger":        ("AI Execution Logger",       "AI"),
        # Specs
        "spec_loader":                ("Spec Loader",               "Specs"),
        "spec_relevance_filter":      ("Spec Filter",               "Specs"),
        "contract_renderer":          ("Contract Renderer",         "Specs"),
        # Validation
        "json_schema_validator":      ("JSON Schema",               "Validation"),
        "local_qa":                   ("Local QA",                  "Validation"),
        "error_classifier":           ("Error Classifier",          "Validation"),
        "phase_score_calculator":     ("Phase Score",               "Validation"),
        # Observability
        "telemetry_emitter":          ("Telemetry",                 "Observability"),
        "job_child_creator":          ("Child Job",                 "Observability"),
        # Legacy / routing
        "router":                     ("Router",                    "Routing"),
        "retry":                      ("Retry",                     "Resilience"),
        # v3.5 ControlFlow
        "if_else":                    ("If / Else",                 "ControlFlow"),
        "switch":                     ("Switch",                    "ControlFlow"),
        "for_each":                   ("For Each",                  "ControlFlow"),
        "while_loop":                 ("While",                     "ControlFlow"),
        "logical_and":                ("AND",                       "ControlFlow"),
        "logical_or":                 ("OR",                        "ControlFlow"),
        "logical_not":                ("NOT",                       "ControlFlow"),
    }
    def _resolve_utility_template(kind: str) -> dict:
        label, category = _KIND_META.get(kind, (kind, "Outras"))
        color, icon = _CAT_DEFAULTS.get(category, ("#94a3b8", "circle"))
        return {"label": label, "category": category, "color": color, "icon": icon}

    # v3.6.0: cluster funcional por kind. Agrupa steps em containers visuais
    # dentro do sub-subflow. Ordem dos clusters define ordem horizontal.
    _CLUSTER_ORDER = [
        "Preparação", "Pré-checks", "Build Prompt", "Decisão", "AI Call",
        "Pós-processamento", "Validação", "Persistência", "Observabilidade",
    ]
    _CLUSTER_COLOR: dict[str, str] = {
        "Preparação":         "#0891b2",  # cyan (Discovery)
        "Pré-checks":         "#3b82f6",  # blue (Resilience)
        "Build Prompt":       "#0ea5e9",  # sky (Specs)
        "Decisão":            "#dc2626",  # red (ControlFlow)
        "AI Call":            "#7c3aed",  # purple (AI/model)
        "Pós-processamento":  "#f59e0b",  # amber (Processing)
        "Validação":          "#22c55e",  # green (Validation)
        "Persistência":       "#8b5cf6",  # violet (Storage)
        "Observabilidade":    "#64748b",  # slate (Observability)
    }
    _KIND_CLUSTER: dict[str, str] = {
        # Preparação (descoberta + grouping)
        "file_scanner":               "Preparação",
        "file_type_classifier":       "Preparação",
        "semantic_layer_classifier":  "Preparação",
        "change_detector":            "Preparação",
        "domain_grouper":             "Preparação",
        "git_commit_fetcher":         "Preparação",
        "rag_query":                  "Preparação",
        # Pré-checks
        "quota_probe":                "Pré-checks",
        "provider_health_check":      "Pré-checks",
        "model_selector":             "Pré-checks",
        # Build Prompt
        "spec_loader":                "Build Prompt",
        "spec_relevance_filter":      "Build Prompt",
        "content_truncator":          "Build Prompt",
        "json_compactor":             "Build Prompt",
        "prompt_context_compressor":  "Build Prompt",
        "contract_renderer":          "Build Prompt",
        # Decisão (control flow)
        "if_else":                    "Decisão",
        "switch":                     "Decisão",
        "for_each":                   "Decisão",
        "while_loop":                 "Decisão",
        "logical_and":                "Decisão",
        "logical_or":                 "Decisão",
        "logical_not":                "Decisão",
        "router":                     "Decisão",
        # Pós-processamento
        "json_extractor":             "Pós-processamento",
        "epic_deduplicator":          "Pós-processamento",
        "card_hierarchy_builder":     "Pós-processamento",
        "text_chunker":               "Pós-processamento",
        # Validação
        "json_schema_validator":      "Validação",
        "local_qa":                   "Validação",
        "phase_score_calculator":     "Validação",
        "error_classifier":           "Validação",
        "validator":                  "Validação",
        # Persistência
        "business_rule_storer":       "Persistência",
        "pipeline_artifact_writer":   "Persistência",
        "wiki_page_writer":           "Persistência",
        "checkpoint_saver":           "Persistência",
        "embed_and_store":            "Persistência",
        # Observabilidade
        "ai_execution_logger":        "Observabilidade",
        "token_cost_calculator":      "Observabilidade",
        "telemetry_emitter":          "Observabilidade",
        "job_child_creator":          "Observabilidade",
    }
    def _cluster_for(kind_or_model: str) -> str:
        """Resolve cluster. model:* sempre vai pra AI Call."""
        if isinstance(kind_or_model, str) and kind_or_model.startswith("model:"):
            return "AI Call"
        return _KIND_CLUSTER.get(kind_or_model, "Pós-processamento")

    # v3.5.3: helper pra gerar edges com o MESMO formato que o frontend
    # produz via addEdge/onConnect — type=smartEdge, markerEnd ArrowClosed,
    # mesma cor que o stroke. Garante que edges nascidas no backend visual-
    # mente correspondam às criadas pelo usuário arrastando.
    def _make_edge(
        edge_id: str, source: str, target: str,
        *, stroke: str = "#3b82f6", stroke_width: float = 1.8,
        dashed: bool = False, port_type: str = "step_sequence",
        planned: bool = False, source_handle: str | None = None,
        target_handle: str | None = None, label: str | None = None,
    ) -> dict:
        style: dict = {"stroke": stroke, "strokeWidth": stroke_width}
        if dashed:
            style["strokeDasharray"] = "4 4"
        # v3.5.5: declarar handles explícitos pra evitar ReactFlow adivinhar
        # qual handle usar. Padrão: source=right, target=left (fluxo
        # horizontal). Quem precisar outros handles passa explicitamente.
        edge: dict = {
            "id": edge_id,
            "source": source,
            "target": target,
            "sourceHandle": source_handle or "right",
            "targetHandle": target_handle or "left",
            "type": "smartEdge",
            "style": style,
            "markerEnd": {
                "type": "arrowclosed",  # ReactFlow MarkerType.ArrowClosed value
                "color": stroke,
                "width": 16,
                "height": 16,
            },
            "data": {"port_type": port_type, "planned": planned},
        }
        if label:
            edge["label"] = label
            edge["data"]["label"] = label
        return edge

    # ── 1. Hierarquia 3 níveis: Root → Áreas (L1) → Sub-subflows (L2) → Steps (L3)
    #
    # Cada NÍVEL é uma tab/subflow no canvas:
    #
    #   Nível 1 (root tab):  4 SubflowNodes (Discovery, Cards, Wiki, QA)
    #     em sequência, sem ioNodes (a sequência É o pipeline).
    #
    #   Nível 2 (área tab):  N SubflowNodes (Phase0_Scan, Phase1_FileAnalysis...)
    #     entre 1 ioNode Entrada e 1 ioNode Saída da área.
    #
    #   Nível 3 (sub-subflow tab):  cadeia de utilityNodes (+ modelNode) entre
    #     1 ioNode Entrada e 1 ioNode Saída do sub-subflow. ESTE é o nível
    #     executável.
    # v3.5.4: espaçamentos aumentados pra evitar colisão entre edges e nodes.
    # Nodes do ReactFlow têm largura ~200-240px (utility) e ~240px (subflow);
    # gap horizontal precisa ser maior que isso pra A* do SmartEdge encontrar
    # caminho ortogonal sem passar por cima.
    ROOT_SUBFLOW_X = 320
    ROOT_SUBFLOW_Y_BASE = 80
    ROOT_SUBFLOW_GAP = 180  # vertical entre áreas no root tab

    # Layout dentro de uma área (nível 2)
    L2_INNER_Y = 240
    L2_INNER_X_IN = 100
    L2_INNER_X_STEP = 340  # 260→340 (subflowNodes têm 240px de largura)

    # Layout dentro de um sub-subflow (nível 3) — cadeia longa de steps
    L3_INNER_Y = 240
    L3_INNER_X_IN = 80
    L3_INNER_X_STEP = 300  # 200→300 (utility/control nodes têm 200-220px)

    prev_l1_node_id: str | None = None
    areas_count = len(DEEP_PIPELINE_HIERARCHY)
    for l1_idx, area in enumerate(DEEP_PIPELINE_HIERARCHY):
        l1_sf_id = f"sf-{area['id']}"
        l1_in_id = f"sf-{area['id']}-in"
        l1_out_id = f"sf-{area['id']}-out"
        l1_inner_ids: list[str] = [l1_in_id]
        l1_child_subflow_ids: list[str] = []

        # v3.5.1: parent_context da área — predecessor/sucessor são áreas
        # irmãs no ROOT. O Start da área herda de "ROOT_START" (entrada do
        # pipeline) ou da área anterior; o End vai pra próxima área ou
        # "ROOT_END" (fim do pipeline).
        if l1_idx == 0:
            area_predecessor = {"kind": "root_start", "label": "Pipeline"}
        else:
            prev_area = DEEP_PIPELINE_HIERARCHY[l1_idx - 1]
            area_predecessor = {"kind": "sibling_area", "node_id": f"sf-{prev_area['id']}-out",
                                "area_id": prev_area["id"], "label": prev_area["label"]}
        if l1_idx == areas_count - 1:
            area_successor = {"kind": "root_end", "label": "Pipeline"}
        else:
            next_area = DEEP_PIPELINE_HIERARCHY[l1_idx + 1]
            area_successor = {"kind": "sibling_area", "node_id": f"sf-{next_area['id']}-in",
                              "area_id": next_area["id"], "label": next_area["label"]}

        # Entrada da área (L2)
        nodes.append({
            "id": l1_in_id, "type": "ioNode",
            "position": {"x": L2_INNER_X_IN, "y": L2_INNER_Y},
            "data": {
                "label": f"Entrada — {area['label']}",
                "io_kind": "input",
                "area_id": area["id"],
                "parent_context": {
                    "parent_id": "__root__",
                    "parent_label": "Pipeline",
                    "comes_from": area_predecessor,
                },
            },
        })

        # Para cada sub-subflow (Nível 2), criar 1 subflowNode + 1 subflow entry
        prev_l2_node_id = l1_in_id
        children_count = len(area["children"])
        for l2_idx, sub in enumerate(area["children"]):
            sub_sf_id = f"sf-{sub['id']}"
            l2_x = L2_INNER_X_IN + (l2_idx + 1) * L2_INNER_X_STEP

            # v3.5.1: parent_context — quem é o predecessor/sucessor desse
            # sub-subflow no fluxo do PAI (área L1). O End do sub-subflow
            # aponta pro Start do próximo node do pai (próximo sub-subflow
            # ou Saída da área).
            if l2_idx == 0:
                parent_predecessor = {"kind": "area_input", "node_id": l1_in_id, "label": area["label"]}
            else:
                prev_sub = area["children"][l2_idx - 1]
                parent_predecessor = {"kind": "sibling_subflow", "node_id": f"sf-{prev_sub['id']}-out",
                                      "subflow_id": prev_sub["id"], "label": prev_sub["label"]}
            if l2_idx == children_count - 1:
                parent_successor = {"kind": "area_output", "node_id": l1_out_id, "label": area["label"]}
            else:
                next_sub = area["children"][l2_idx + 1]
                parent_successor = {"kind": "sibling_subflow", "node_id": f"sf-{next_sub['id']}-in",
                                    "subflow_id": next_sub["id"], "label": next_sub["label"]}

            # SubflowNode visível dentro da área tab (representa o sub-subflow)
            nodes.append({
                "id": sub_sf_id, "type": "subflowNode",
                "position": {"x": l2_x, "y": L2_INNER_Y},
                "data": {
                    "label": sub["label"],
                    "kind": "deep_pipeline_step",
                    "phase_key": sub.get("phase_key"),
                    "area_id": area["id"],
                    "step_id": sub["id"],
                    "node_count": len(sub["steps"]) + 2,  # +Entrada/Saída
                    "collapsed": True,
                    "parent_context": {
                        "parent_id": area["id"],
                        "parent_label": area["label"],
                        "predecessor": parent_predecessor,
                        "successor": parent_successor,
                    },
                },
            })
            l1_inner_ids.append(sub_sf_id)
            l1_child_subflow_ids.append(sub["id"])

            # Sequência L2: predecessor → este subflowNode
            edges.append(_make_edge(
                f"edge-{prev_l2_node_id}-{sub_sf_id}",
                prev_l2_node_id, sub_sf_id,
                stroke="#3b82f6", stroke_width=1.8,
                port_type="area_sequence",
            ))
            prev_l2_node_id = sub_sf_id

            # ── Nível 3: layout 2D agrupado por cluster funcional ──
            #
            # v3.6.0: em vez de cadeia linear (1 step por coluna), agrupa os
            # steps em CLUSTERS funcionais (Preparação, Pré-checks, Build
            # Prompt, Decisão, AI Call, Pós-processamento, Validação,
            # Persistência, Observabilidade). Cada cluster vira um GroupNode
            # (container retangular) e seus steps ficam empilhados verticalmente
            # dentro dele com parentId pra mover juntos.
            l3_in_id = f"sf-{sub['id']}-in"
            l3_out_id = f"sf-{sub['id']}-out"
            l3_inner_ids: list[str] = [l3_in_id]

            # 1ª passada: classifica steps por cluster preservando ordem original
            sub_steps = sub["steps"]
            steps_by_cluster: dict[str, list[tuple[int, tuple, str]]] = {}
            step_ids_in_order: list[str] = []
            for step_idx, (kind_or_model, opts) in enumerate(sub_steps):
                cluster = _cluster_for(kind_or_model)
                step_node_id = f"step-{sub['id']}-{step_idx}-{kind_or_model.replace(':', '-')}"
                steps_by_cluster.setdefault(cluster, []).append(
                    (step_idx, (kind_or_model, opts), step_node_id)
                )
                step_ids_in_order.append(step_node_id)

            # Ordem das colunas seguindo _CLUSTER_ORDER (só inclui clusters
            # que têm pelo menos 1 step)
            active_clusters = [c for c in _CLUSTER_ORDER if c in steps_by_cluster]

            # Layout: clusters em colunas horizontais (X), steps empilhados
            # verticalmente (Y) dentro de cada cluster.
            COL_WIDTH = 240         # largura de cada cluster
            COL_GAP = 60            # espaço entre clusters
            ROW_HEIGHT = 100        # altura de cada step
            ROW_GAP = 14            # espaço entre steps verticalmente
            GROUP_HEADER_H = 32     # altura do cabeçalho do GroupNode
            GROUP_PAD_X = 16        # padding horizontal interno
            GROUP_PAD_Y = 10        # padding vertical interno (depois do header)

            # ioNodes ficam ao lado dos clusters (Entrada à esquerda, Saída à direita).
            IO_X = 20
            IO_W = 180  # largura visual de um ioNode

            # Centro vertical (Y do grupo) base — Y=80 leva em conta o header da tab
            CLUSTER_Y_BASE = 80

            # Entrada do sub-subflow
            nodes.append({
                "id": l3_in_id, "type": "ioNode",
                "position": {"x": IO_X, "y": CLUSTER_Y_BASE + 20},
                "data": {
                    "label": f"Entrada — {sub['label']}",
                    "io_kind": "input",
                    "step_id": sub["id"],
                    "parent_context": {
                        "parent_id": area["id"],
                        "parent_label": area["label"],
                        "comes_from": parent_predecessor,
                    },
                },
            })

            # 2ª passada: cria GroupNodes (containers) + step nodes dentro
            group_id_for_cluster: dict[str, str] = {}
            cluster_x_start: dict[str, float] = {}
            current_x = IO_X + IO_W + COL_GAP
            for cluster in active_clusters:
                steps_in_cluster = steps_by_cluster[cluster]
                # Altura do grupo = header + items + padding
                group_h = GROUP_HEADER_H + GROUP_PAD_Y + len(steps_in_cluster) * (ROW_HEIGHT + ROW_GAP) - ROW_GAP + GROUP_PAD_Y
                group_node_id = f"group-{sub['id']}-{cluster.lower().replace(' ', '-').replace('é','e').replace('ã','a').replace('ç','c').replace('ó','o')}"
                color = _CLUSTER_COLOR.get(cluster, "#94a3b8")
                # GroupNode (parent container) — v3.6.4
                # `style.width/height` é a dimensão INICIAL; o user pode
                # redimensionar via <NodeResizer/> e o ReactFlow atualiza
                # esse style. Não usar `zIndex: -1` (faz o group sumir atrás
                # do canvas); o z-index correto sai do CSS do ReactFlow que
                # já coloca groups abaixo dos children.
                nodes.append({
                    "id": group_node_id,
                    "type": "groupNode",
                    "position": {"x": current_x, "y": CLUSTER_Y_BASE},
                    "style": {"width": COL_WIDTH, "height": group_h},
                    "data": {
                        "label": cluster,
                        "color": color,
                        "step_id": sub["id"],
                        "cluster": cluster,
                        "description": f"{len(steps_in_cluster)} {'item' if len(steps_in_cluster)==1 else 'itens'}",
                    },
                })
                l3_inner_ids.append(group_node_id)
                group_id_for_cluster[cluster] = group_node_id
                cluster_x_start[cluster] = current_x

                # Steps dentro do GroupNode — coordenadas RELATIVAS ao parent
                for local_idx, (step_idx, (kind_or_model, opts), step_node_id) in enumerate(steps_in_cluster):
                    is_model = isinstance(kind_or_model, str) and kind_or_model.startswith("model:")
                    planned = bool(opts.get("planned"))
                    # Posição relativa: x dentro do padding, y abaixo do header
                    rel_x = GROUP_PAD_X
                    rel_y = GROUP_HEADER_H + GROUP_PAD_Y + local_idx * (ROW_HEIGHT + ROW_GAP)

                    if is_model:
                        assigned_model_id = kind_or_model.split(":", 1)[1]
                        ai_model = model_by_id.get(assigned_model_id)
                        nodes.append({
                            "id": step_node_id, "type": "modelNode",
                            "position": {"x": rel_x, "y": rel_y},
                            "parentId": group_node_id,
                            "extent": "parent",
                            "data": {
                                "label": ai_model.name if ai_model else assigned_model_id,
                                "provider": "claudius",
                                "config": (ai_model.config if ai_model else {"model_id": assigned_model_id}) or {},
                                "model_id": assigned_model_id,
                                "ai_model_id": str(ai_model.id) if ai_model else None,
                                "phase_key": sub.get("phase_key"),
                                "step_id": sub["id"],
                                "cluster": cluster,
                                "call_kind": opts.get("call_kind"),
                                "max_concurrency": opts.get("max_concurrency"),
                                "thinking_budget": opts.get("thinking_budget"),
                                "max_tokens": opts.get("max_tokens"),
                                "optional": opts.get("optional", False),
                                "planned": planned,
                                "animation": "idle",
                            },
                        })
                    else:
                        tpl = _resolve_utility_template(kind_or_model)
                        is_control_flow = tpl["category"] == "ControlFlow"
                        react_type = "controlFlowNode" if is_control_flow else "utilityNode"
                        schema = _schema_to_dict(_schema_for(kind_or_model)) if is_control_flow else None
                        node_data = {
                            "label": tpl["label"],
                            "kind": kind_or_model,
                            "category": tpl["category"],
                            "color": tpl["color"],
                            "icon": tpl["icon"],
                            "step_id": sub["id"],
                            "cluster": cluster,
                            "phase_key": sub.get("phase_key"),
                            "planned": planned,
                            "config": opts.get("config") or {},
                            "enabled": not planned,
                        }
                        if schema:
                            node_data["inputs"] = schema["inputs"]
                            node_data["outputs"] = schema["outputs"]
                            node_data["dynamic_outputs"] = schema["dynamic_outputs"]
                            if kind_or_model == "switch":
                                cases = (opts.get("config") or {}).get("cases") or []
                                extra = [{"name": c, "type": TYPE_ANY} for c in cases]
                                node_data["outputs"] = extra + node_data["outputs"]
                        nodes.append({
                            "id": step_node_id, "type": react_type,
                            "position": {"x": rel_x, "y": rel_y},
                            "parentId": group_node_id,
                            "extent": "parent",
                            "data": node_data,
                        })
                    l3_inner_ids.append(step_node_id)

                current_x += COL_WIDTH + COL_GAP

            # Saída do sub-subflow (depois da última coluna)
            l3_out_x = current_x
            nodes.append({
                "id": l3_out_id, "type": "ioNode",
                "position": {"x": l3_out_x, "y": CLUSTER_Y_BASE + 20},
                "data": {
                    "label": f"Saída — {sub['label']}",
                    "io_kind": "output",
                    "step_id": sub["id"],
                    "parent_context": {
                        "parent_id": area["id"],
                        "parent_label": area["label"],
                        "goes_to": parent_successor,
                    },
                },
            })

            # Edges: conecta Entrada → primeiro step da primeira coluna,
            # depois step → próximo step dentro do mesmo cluster (vertical),
            # último step de uma coluna → primeiro step da próxima coluna,
            # último step de tudo → Saída.
            # Cria a lista LINEAR final dos step_ids na ordem visual.
            visual_order: list[str] = []
            for cluster in active_clusters:
                for (_, _, sid) in steps_by_cluster[cluster]:
                    visual_order.append(sid)

            prev_source_handle: str = "right"
            prev_node_id: str = l3_in_id
            for sid in visual_order:
                # Look up the node we just added to figure out type/handles
                n = next((x for x in reversed(nodes) if x["id"] == sid), None)
                if not n:
                    continue
                planned = bool(n["data"].get("planned"))
                is_control_flow_target = n["type"] == "controlFlowNode"

                target_handle = "left"
                if is_control_flow_target:
                    inputs = n["data"].get("inputs") or []
                    if inputs:
                        target_handle = inputs[0]["name"]

                edges.append(_make_edge(
                    f"edge-{prev_node_id}-{sid}",
                    prev_node_id, sid,
                    stroke="#9ca3af" if planned else "#3b82f6",
                    stroke_width=1.6,
                    dashed=planned,
                    port_type="step_sequence",
                    planned=planned,
                    source_handle=prev_source_handle,
                    target_handle=target_handle,
                ))

                if is_control_flow_target:
                    outputs = n["data"].get("outputs") or []
                    prev_source_handle = outputs[0]["name"] if outputs else "right"
                else:
                    prev_source_handle = "right"
                prev_node_id = sid

            # Edge final: último step → ioNode Saída
            l3_inner_ids.append(l3_out_id)
            edges.append(_make_edge(
                f"edge-{prev_node_id}-{l3_out_id}",
                prev_node_id, l3_out_id,
                stroke="#3b82f6", stroke_width=1.6,
                port_type="step_sequence",
                source_handle=prev_source_handle,
            ))

            # Persistir o sub-subflow no dict subflows
            subflows[sub["id"]] = {
                "label": sub["label"],
                "node_ids": l3_inner_ids,
                "position": {"x": l2_x, "y": L2_INNER_Y},
                "collapsed": True,
                "kind": "deep_pipeline_step",
                "parent_id": area["id"],
                "phase_key": sub.get("phase_key"),
            }

        # Saída da área (L2): último sub-subflow → Saída
        l1_out_x = L2_INNER_X_IN + (len(area["children"]) + 1) * L2_INNER_X_STEP
        nodes.append({
            "id": l1_out_id, "type": "ioNode",
            "position": {"x": l1_out_x, "y": L2_INNER_Y},
            "data": {
                "label": f"Saída — {area['label']}",
                "io_kind": "output",
                "area_id": area["id"],
                "parent_context": {
                    "parent_id": "__root__",
                    "parent_label": "Pipeline",
                    "goes_to": area_successor,
                },
            },
        })
        l1_inner_ids.append(l1_out_id)
        edges.append(_make_edge(
            f"edge-{prev_l2_node_id}-{l1_out_id}",
            prev_l2_node_id, l1_out_id,
            stroke="#3b82f6", stroke_width=1.8,
            port_type="area_sequence",
        ))

        # Persistir a área (L1)
        subflows[area["id"]] = {
            "label": area["label"],
            "node_ids": l1_inner_ids,
            "child_subflow_ids": l1_child_subflow_ids,
            "position": {"x": ROOT_SUBFLOW_X, "y": ROOT_SUBFLOW_Y_BASE + l1_idx * ROOT_SUBFLOW_GAP},
            "collapsed": True,
            "kind": "deep_pipeline_area",
            "order": area["order"],
        }
        # SubflowNode visível no ROOT (representa a área)
        nodes.append({
            "id": l1_sf_id,
            "type": "subflowNode",
            "position": {"x": ROOT_SUBFLOW_X, "y": ROOT_SUBFLOW_Y_BASE + l1_idx * ROOT_SUBFLOW_GAP},
            "data": {
                "label": area["label"],
                "collapsed": True,
                "node_count": len(area["children"]),  # # de sub-subflows
                "kind": "deep_pipeline_area",
                "area_id": area["id"],
                "child_subflow_count": len(l1_child_subflow_ids),
            },
        })
        # Wire root areas sequentially: Discovery → Cards → Wiki → QA
        if prev_l1_node_id is not None:
            edges.append(_make_edge(
                f"edge-{prev_l1_node_id}-{l1_sf_id}",
                prev_l1_node_id, l1_sf_id,
                stroke="#3b82f6", stroke_width=2,
                port_type="root_sequence",
                label="then",
            ))
        prev_l1_node_id = l1_sf_id

    # ── 3. Model catalog — sidebar items (NOT on the canvas).
    # v3.2: models live in the left sidebar. They become canvas nodes only
    # when the user drags them in (frontend creates a node with this template).
    catalog_models: list[dict] = []
    for m in models:
        cfg = m.config or {}
        mid = cfg.get("model_id") or "claude-sonnet-4-6"
        primary_usage = (m.usage_type.value if hasattr(m.usage_type, "value") else str(m.usage_type))
        usage_badges = list({primary_usage, *model_pk_to_usages.get(str(m.id), [])})
        catalog_models.append({
            "id": f"model-{m.id}",
            "type": "modelNode",
            "data": {
                "label": m.name,
                "provider": "claudius",
                "config": cfg,
                "rate_limit_requests": m.rate_limit_requests,
                "timeout_seconds": m.timeout_seconds,
                "model_id": mid,
                "usage_type": primary_usage,
                "usage_badges": sorted(usage_badges),
                "ai_model_id": str(m.id),
            },
        })

    # ────────────────────────────────────────────────────────────────────
    # v3.4 — full utility-node catalog (66 → 34 essentials for the canvas).
    #
    # Each entry is a draggable TEMPLATE. When the user drops it on the
    # canvas, the frontend creates a real Node with `data.kind=<key>` so
    # the future GraphExecutor (Entrega B) can dispatch the right backend
    # executor.
    #
    # Pre-existing utility node types kept (cacheNode, etc) for back-compat;
    # all the new ones use the generic `utilityNode` renderer with metadata
    # in `data` (kind, category, icon, color) to avoid 30+ near-identical
    # React components.
    # ────────────────────────────────────────────────────────────────────
    def _u(kind: str, label: str, category: str, color: str, icon: str,
           config: dict | None = None, react_type: str = "utilityNode",
           description: str | None = None) -> dict:
        # v3.5: ship inputs/outputs in the template so multi-handle renderers
        # (controlFlowNode) know which handles to draw, and the frontend
        # validator can check connections without a separate schema lookup.
        schema = _schema_to_dict(_schema_for(kind))
        return {
            "id": f"util-{kind}",
            "type": react_type,
            "data": {
                "label": label,
                "kind": kind,
                "category": category,
                "color": color,
                "icon": icon,
                "config": config or {},
                "enabled": True,
                "description": description,
                "inputs": schema["inputs"],
                "outputs": schema["outputs"],
                "dynamic_outputs": schema["dynamic_outputs"],
            },
        }

    catalog_utilities = [
        # ── Legacy (v3.0) — kept with their original React components ────
        {"id": "util-cache",              "type": "cacheNode",            "data": {"label": "Cache",         "kind": "cache",              "category": "Storage",        "color": "#8b5cf6", "icon": "database",   "config": {}, "enabled": True}},
        {"id": "util-rag_context",        "type": "ragContextNode",       "data": {"label": "RAG Context",   "kind": "rag_context",        "category": "Storage",        "color": "#06b6d4", "icon": "search",     "config": {}, "enabled": True}},
        {"id": "util-router",             "type": "routerNode",           "data": {"label": "Router",        "kind": "router",             "category": "Routing",        "color": "#10b981", "icon": "git-fork",   "config": {}, "enabled": True}},
        {"id": "util-retry",              "type": "retryNode",            "data": {"label": "Retry",         "kind": "retry",              "category": "Resilience",     "color": "#3b82f6", "icon": "repeat",     "config": {"max_retries": 3, "backoff_base_ms": 1000}, "enabled": True}},
        {"id": "util-validator",          "type": "validatorNode",        "data": {"label": "Validator",     "kind": "validator",          "category": "Validation",     "color": "#22c55e", "icon": "check-circle","config": {}, "enabled": True}},
        {"id": "util-cost_guard",         "type": "costGuardNode",        "data": {"label": "Cost Guard",    "kind": "cost_guard",         "category": "Resilience",     "color": "#ef4444", "icon": "shield-alert","config": {}, "enabled": True}},
        {"id": "util-rate_limiter",       "type": "rateLimiterNode",      "data": {"label": "Rate Limiter",  "kind": "rate_limiter",       "category": "Resilience",     "color": "#ec4899", "icon": "timer",      "config": {}, "enabled": True}},
        {"id": "util-timeout",            "type": "timeoutNode",          "data": {"label": "Timeout",       "kind": "timeout",            "category": "Resilience",     "color": "#f97316", "icon": "clock",      "config": {"timeout_seconds": 120}, "enabled": True}},
        {"id": "util-prompt_transformer", "type": "promptTransformerNode","data": {"label": "Prompt Xform",  "kind": "prompt_transformer", "category": "Processing",     "color": "#f59e0b", "icon": "edit",       "config": {}, "enabled": True}},

        # ── v3.4 wave 1+2 — Discovery / Filesystem ───────────────────────
        _u("file_scanner",                "File Scanner",            "Discovery",      "#0891b2", "folder-search",
           {"max_file_size": 100_000, "extensions": [], "follow_symlinks": False, "reuse_cached_paths": True},
           description="Walk filesystem + apply ignore patterns"),
        _u("file_type_classifier",        "File Type Classifier",    "Discovery",      "#0891b2", "tag",
           {"keyword_map": "default"},
           description="Classify path as model/route/test/migration/ui/config"),
        _u("semantic_layer_classifier",   "Semantic Layer",          "Discovery",      "#0891b2", "layers",
           {"layer_order": ["Schema", "Routes", "Logic", "Presentation", "Config"]},
           description="Schema/Routes/Logic/Presentation/Config classification"),
        _u("change_detector",             "Change Detector",         "Discovery",      "#0891b2", "git-compare",
           {"include_deleted": True, "ignore_hash_collisions": False},
           description="Diff vs last scan: new/modified/deleted files"),

        # ── Processing / Transformation ──────────────────────────────────
        _u("content_truncator",           "Content Truncator",       "Processing",     "#f59e0b", "scissors",
           {"max_chars": 8000, "head_ratio": 0.75},
           description="Truncate text head+tail with marker"),
        _u("json_compactor",              "JSON Compactor",          "Processing",     "#f59e0b", "minus-square",
           {"ensure_ascii": False},
           description="Compact JSON (no indent, tight separators)"),
        _u("json_extractor",              "JSON Extractor",          "Processing",     "#f59e0b", "braces",
           {"strict": False, "auto_repair": True},
           description="Parse JSON from AI response (with repair)"),
        _u("domain_grouper",              "Domain Grouper",          "Processing",     "#f59e0b", "group",
           {"min_size": 2, "fold_infra": True},
           description="Group analyses by domain_classification"),
        _u("epic_deduplicator",           "Epic Deduplicator",       "Processing",     "#f59e0b", "copy-x",
           {"similarity_threshold": 0.8, "key_field": "title"},
           description="Drop epics with >80% overlap"),
        _u("card_hierarchy_builder",      "Card Hierarchy",          "Processing",     "#f59e0b", "list-tree",
           {"default_story_points": 3},
           description="Assemble Epic→Story→Task tree in DB"),
        _u("text_chunker",                "Text Chunker",            "Processing",     "#f59e0b", "scroll",
           {"chunk_size": 1500, "overlap": 200},
           description="Split long text into overlapping chunks"),
        _u("git_commit_fetcher",          "Git Commit Fetcher",      "Processing",     "#f59e0b", "git-commit",
           {"max_commits": 50},
           description="Fetch git log for enrichment"),
        _u("prompt_context_compressor",   "Context Compressor",      "Processing",     "#f59e0b", "minimize",
           {"token_budget": 4000},
           description="Compress hierarchy context for prompt"),

        # ── Storage / RAG ────────────────────────────────────────────────
        _u("embed_and_store",             "Embed & Store",           "Storage",        "#8b5cf6", "database-zap",
           {"collection": "default", "embedding_model": "nomic-embed-text"},
           description="Embed content + persist to vector store"),
        _u("rag_query",                   "RAG Query",               "Storage",        "#8b5cf6", "search-check",
           {"top_k": 5, "similarity_threshold": 0.7, "filter": {}},
           description="Pure vector retrieve (no orchestrator)"),
        _u("business_rule_storer",        "Business Rule Storer",    "Storage",        "#8b5cf6", "book-marked",
           {"rule_type": "domain", "priority": "medium"},
           description="Persist a business rule into RAG"),
        _u("pipeline_artifact_writer",    "Artifact Writer",         "Storage",        "#8b5cf6", "save",
           {"artifact_type": "auto"},
           description="Write a PipelineArtifact row"),
        _u("wiki_page_writer",            "Wiki Page Writer",        "Storage",        "#8b5cf6", "book-open",
           {"respect_human_edits": True},
           description="Write WikiPage (skips human-edited pages)"),
        _u("checkpoint_saver",            "Checkpoint Saver",        "Storage",        "#8b5cf6", "bookmark",
           {"scope": "phase", "include_scores": True},
           description="Save PipelineRun checkpoint for resume"),

        # ── AI / Orchestration ───────────────────────────────────────────
        _u("claudius_single_call",        "Claudius Call",           "AI",             "#7c3aed", "sparkles",
           {"model": "claude-sonnet-4-6", "max_tokens": 4000, "thinking_budget": 0},
           description="Single Claude API call (Haiku/Sonnet/Opus)"),
        _u("claudius_batch_call",         "Claudius Batch",          "AI",             "#7c3aed", "sparkles",
           {"max_concurrency": 10, "abort_on_quota": True},
           description="Parallel Claude calls (e.g. per-file analysis)"),
        _u("quota_probe",                 "Quota Probe",             "AI",             "#7c3aed", "gauge",
           {"mode": "status"},
           description="Check Anthropic quota before running"),
        _u("provider_health_check",       "Health Check",            "AI",             "#7c3aed", "heart-pulse",
           {"retries": 3, "backoff": "exponential"},
           description="Health check Claudius with backoff"),
        _u("model_selector",              "Model Selector",          "AI",             "#7c3aed", "shuffle",
           {"usage_type": "general", "prefer_chain": True},
           description="Choose model by usage_type"),
        _u("token_cost_calculator",       "Token Cost",              "AI",             "#7c3aed", "calculator",
           {"pricing": "default"},
           description="Compute input+output cost"),
        _u("ai_execution_logger",         "AI Execution Logger",     "AI",             "#7c3aed", "scroll-text",
           {"include_system_prompt": False},
           description="Log AI call into ai_executions"),

        # ── Specs / Contracts ────────────────────────────────────────────
        _u("spec_loader",                 "Spec Loader",             "Specs",          "#0ea5e9", "file-stack",
           {"active_only": True, "categories": []},
           description="Load active project specs"),
        _u("spec_relevance_filter",       "Spec Filter",             "Specs",          "#0ea5e9", "filter",
           {"max_per_category": 3},
           description="Filter specs by keywords (90% token cut)"),
        _u("contract_renderer",           "Contract Renderer",       "Specs",          "#0ea5e9", "file-text",
           {"contract_name": "", "allow_partial": False},
           description="Render YAML contract with variables"),

        # ── Validation / Observability ───────────────────────────────────
        _u("json_schema_validator",       "JSON Schema",             "Validation",     "#22c55e", "shield-check",
           {"schema": "stories"},
           description="Validate JSON against expected schema"),
        _u("local_qa",                    "Local QA",                "Validation",     "#22c55e", "check-square",
           {"weights": {"rules": 0.4, "cards": 0.3, "wiki": 0.3}},
           description="Heuristic QA (no AI) — alternative to Phase 6"),
        _u("error_classifier",            "Error Classifier",        "Validation",     "#22c55e", "alert-triangle",
           {"rules": "default"},
           description="Classify exception: permanent/transient/oom/quota"),
        _u("phase_score_calculator",      "Phase Score",             "Validation",     "#22c55e", "bar-chart",
           {"weights": "default"},
           description="Compute 0-100 score for a phase result"),
        _u("telemetry_emitter",           "Telemetry",               "Observability",  "#64748b", "activity",
           {"sinks": ["ws", "redis", "db"]},
           description="Emit telemetry event (WS+Redis+DB)"),
        _u("job_child_creator",           "Child Job",               "Observability",  "#64748b", "git-branch",
           {"job_type": "generic", "phase_label": ""},
           description="Create child AsyncJob + lifecycle (start/complete/fail)"),

        # ── v3.5 — Control flow nodes (own React renderer w/ multi-handles)
        # `type: controlFlowNode` triggers the multi-handle renderer on the
        # frontend; `data.kind` picks the variant (if_else/switch/...).
        _u("if_else",       "If / Else",         "ControlFlow",  "#dc2626", "git-branch",
           {"condition": "$.output.score < 70"},
           react_type="controlFlowNode",
           description="2 saídas: true/false. Avalia condição sobre input."),
        _u("switch",        "Switch (multi-way)", "ControlFlow", "#dc2626", "git-fork",
           {"selector": "$.output.kind", "cases": ["case_a", "case_b"]},
           react_type="controlFlowNode",
           description="N saídas nomeadas + default. Avalia selector."),
        _u("for_each",      "For Each",          "ControlFlow",  "#dc2626", "repeat-2",
           {"collection_path": "$.items"},
           react_type="controlFlowNode",
           description="Itera sobre coleção. Saídas: body (1 por item) e done."),
        _u("while_loop",    "While",             "ControlFlow",  "#dc2626", "rotate-cw",
           {"condition": "$.iter < 10"},
           react_type="controlFlowNode",
           description="Loop com condição. Saídas: body e done."),
        _u("logical_and",   "AND",               "ControlFlow",  "#dc2626", "x",
           {},
           react_type="controlFlowNode",
           description="2 entradas booleanas → 1 saída. Merge AND."),
        _u("logical_or",    "OR",                "ControlFlow",  "#dc2626", "x",
           {},
           react_type="controlFlowNode",
           description="2 entradas booleanas → 1 saída. Merge OR."),
        _u("logical_not",   "NOT",               "ControlFlow",  "#dc2626", "x",
           {},
           react_type="controlFlowNode",
           description="Inverte booleano de entrada."),
    ]

    # v3.4: if the user previously saved a customized graph via /canvas-save,
    # use that instead of the default Deep Pipeline scaffold. Persisted under
    # the reserved key `__canvas_graph__` inside phase_configs.
    saved_graph = (profile_phase_configs or {}).get("__canvas_graph__")
    if isinstance(saved_graph, dict) and saved_graph.get("nodes"):
        nodes = saved_graph.get("nodes") or []
        edges = saved_graph.get("edges") or []
        subflows = saved_graph.get("subflows") or {}

    # v3.5: expose I/O type schemas pro frontend validar conexões em tempo real
    types_schema = {kind: _schema_to_dict(schema) for kind, schema in NODE_IO_SCHEMA.items()}

    return {
        "nodes": nodes,
        "edges": edges,
        "subflows": subflows,
        # v3.2 — sidebar catalog (left top section, draggable into canvas)
        "catalog": {
            "models": catalog_models,
            "utilities": catalog_utilities,
        },
        # v3.5 — type schemas per kind, used by useConnectionValidator
        "types_schema": types_schema,
        "meta": {
            "model_count": len(models),
            "chain_count": len(chains),
            "phase_count": len(DEEP_PIPELINE_PHASES),
            "group_count": len(DEEP_PIPELINE_GROUPS),
            "profile_id": str(profile.id) if profile else None,
            "profile_name": profile.name if profile else None,
            "graph_source": "custom" if (isinstance(saved_graph, dict) and saved_graph.get("nodes")) else "default",
            "control_flow_kinds": ["if_else", "switch", "for_each", "while_loop", "logical_and", "logical_or", "logical_not"],
        },
    }


# Backward-compat: keep DEEP_PIPELINE_PHASES exported for callers
DEEP_PIPELINE_PHASES_FALLBACK = DEEP_PIPELINE_PHASES


@router.post("/canvas-save")
async def canvas_save(payload: dict, db: Session = Depends(get_db)):
    """Persist the unified canvas state.

    Payload (all keys optional):
      {
        "models": [ { ai_model_id, name?, config?, rate_limit_requests?, timeout_seconds? } ],
        "phase_configs": { phase_key: { model?, max_tokens?, ... } },
        "chain_overrides": { usage_type: [model_id1, model_id2, ...] }?,
        "subflows": { ... },
        "node_positions": { node_id: {x, y} }?,
        // v3.4 — full graph (user-added utility nodes + edges + subflows)
        // stored in PipelineProfile.metadata.graph as opaque JSON for the
        // future GraphExecutor (Entrega B) to interpret. Nothing is auto-
        // applied to chains/phase_configs from this — it's just persisted.
        "graph": {
          "nodes": [{ id, type, position, data }],
          "edges": [{ id, source, target, type, data }],
          "subflows": { sf_id: { label, node_ids, position, collapsed } }
        }?
      }

    Returns counts of what was applied.
    """
    from app.models.ai_model import AIModel
    from app.models.pipeline_profile import PipelineProfile
    from datetime import datetime as _dt

    payload = payload or {}
    models_payload = payload.get("models") or []
    phase_configs_payload = payload.get("phase_configs") or {}
    chain_overrides = payload.get("chain_overrides") or {}
    graph_payload = payload.get("graph") or None

    models_updated = 0
    model_errors: list[str] = []

    # 1) Patch per-model edits
    for entry in models_payload:
        aid = entry.get("ai_model_id")
        if not aid:
            continue
        try:
            m = db.query(AIModel).filter(AIModel.id == aid).first()
            if not m:
                model_errors.append(f"model {aid} not found")
                continue
            if "name" in entry and entry["name"]:
                m.name = entry["name"]
            if "config" in entry and isinstance(entry["config"], dict):
                # Validate model_id whitelist (v2.5)
                mid = (entry["config"].get("model_id") or "").strip()
                if mid and mid not in {"claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"}:
                    model_errors.append(f"model {aid} invalid model_id={mid}")
                    continue
                m.config = entry["config"]
            if "rate_limit_requests" in entry and entry["rate_limit_requests"] is not None:
                m.rate_limit_requests = int(entry["rate_limit_requests"])
            if "timeout_seconds" in entry and entry["timeout_seconds"] is not None:
                m.timeout_seconds = int(entry["timeout_seconds"])
            m.updated_at = _dt.utcnow()
            models_updated += 1
        except Exception as e:
            model_errors.append(f"model {aid}: {type(e).__name__}: {str(e)[:80]}")

    try:
        db.commit()
    except Exception:
        db.rollback()

    # 2) UPSERT pipeline profile "Canvas" (default).
    # v3.4: if `graph` payload is supplied, persist it inside phase_configs
    # under the reserved key `__canvas_graph__` (avoids alembic migration for
    # a new column; the snapshot endpoint can read it back). The reserved key
    # is filtered out of phase_catalog in _merge_phase_configs.
    profile_updated = False
    profile_id = None
    if graph_payload is not None:
        # Force profile update path even if phase_configs_payload is empty
        if not phase_configs_payload:
            phase_configs_payload = {}
        phase_configs_payload["__canvas_graph__"] = {
            "saved_at": _dt.utcnow().isoformat(),
            "nodes": graph_payload.get("nodes") or [],
            "edges": graph_payload.get("edges") or [],
            "subflows": graph_payload.get("subflows") or {},
        }
    if phase_configs_payload:
        try:
            existing = (
                db.query(PipelineProfile)
                .filter(PipelineProfile.name == "Canvas")
                .first()
            )
            if existing:
                # Merge with current phase_configs (preserve unknown keys)
                merged = dict(existing.phase_configs or {})
                for pk, cfg in phase_configs_payload.items():
                    if isinstance(cfg, dict):
                        merged[pk] = {**(merged.get(pk) or {}), **cfg}
                existing.phase_configs = merged
                existing.updated_at = _dt.utcnow()
                # Ensure it's the default (mark others as non-default in same tx)
                db.query(PipelineProfile).filter(
                    PipelineProfile.id != existing.id,
                    PipelineProfile.is_default == True,
                ).update({"is_default": False})
                existing.is_default = True
                profile_id = str(existing.id)
                profile_updated = True
            else:
                # Demote any current default
                db.query(PipelineProfile).filter(
                    PipelineProfile.is_default == True,
                ).update({"is_default": False})
                from uuid import uuid4 as _uuid4
                new_profile = PipelineProfile(
                    id=_uuid4(),
                    name="Canvas",
                    description="Auto-managed by the AI Studio canvas",
                    phase_configs=phase_configs_payload,
                    quality_threshold=70,
                    is_default=True,
                    created_at=_dt.utcnow(),
                    updated_at=_dt.utcnow(),
                )
                db.add(new_profile)
                db.flush()
                profile_id = str(new_profile.id)
                profile_updated = True
            db.commit()
        except Exception as e:
            db.rollback()
            model_errors.append(f"pipeline_profile: {type(e).__name__}: {str(e)[:80]}")

    # 3) chain_overrides (per usage_type) — UPSERT in ai_flow_chains
    chains_updated = 0
    if chain_overrides:
        from app.models.ai_flow_chain import AIFlowChain
        from app.models.ai_model import AIModelUsageType
        for usage, model_pks in chain_overrides.items():
            try:
                # Normalize usage_type to enum value (string)
                if not isinstance(model_pks, list):
                    continue
                model_pks = [str(x) for x in model_pks if x]
                ch = (
                    db.query(AIFlowChain)
                    .filter(AIFlowChain.usage_type == usage)
                    .first()
                )
                if ch:
                    ch.chain = model_pks
                    ch.updated_at = _dt.utcnow()
                else:
                    from uuid import uuid4 as _uuid4
                    ch = AIFlowChain(
                        id=_uuid4(),
                        usage_type=AIModelUsageType(usage),
                        chain=model_pks,
                        is_active=True,
                        created_at=_dt.utcnow(),
                        updated_at=_dt.utcnow(),
                    )
                    db.add(ch)
                chains_updated += 1
            except Exception as e:
                model_errors.append(f"chain {usage}: {type(e).__name__}: {str(e)[:80]}")
        try:
            db.commit()
        except Exception:
            db.rollback()

    return {
        "models_updated": models_updated,
        "profile_updated": profile_updated,
        "profile_id": profile_id,
        "chains_updated": chains_updated,
        "errors": model_errors,
    }




# ============================================================================
# PROMPT #122 - Chain CRUD
# ============================================================================

def _resolve_chain_models(db: Session, chain_ids: List[str]) -> List[dict]:
    """Resolve list of model UUIDs to full model objects for frontend display."""
    models = []
    for model_id in chain_ids:
        model = db.query(AIModel).filter(AIModel.id == model_id).first()
        if model:
            models.append({
                "id": str(model.id),
                "name": model.name,
                "provider": model.provider,
                "usage_type": model.usage_type.value if hasattr(model.usage_type, "value") else model.usage_type,
                "is_active": model.is_active,
                "config": model.config or {},
                "rate_limit_requests": model.rate_limit_requests,
                "rate_limit_window_seconds": model.rate_limit_window_seconds,
            })
        else:
            models.append({
                "id": model_id,
                "name": "Desconhecido (excluido)",
                "provider": "unknown",
                "usage_type": "general",
                "is_active": False,
                "config": {},
                "rate_limit_requests": None,
                "rate_limit_window_seconds": None,
            })
    return models


def _chain_to_dict(chain: AIFlowChain, models: List[dict]) -> dict:
    return {
        "id": chain.id,
        "usage_type": chain.usage_type.value if hasattr(chain.usage_type, "value") else chain.usage_type,
        "chain": chain.chain,
        "node_positions": chain.node_positions,
        "utility_nodes": chain.utility_nodes,
        "is_active": chain.is_active,
        "created_at": chain.created_at,
        "updated_at": chain.updated_at,
        "models": models,
    }


@router.get("/chains", response_model=List[AIFlowChainWithModels])
async def list_chains(db: Session = Depends(get_db)):
    """List all flow chains with their associated model details."""
    chains = db.query(AIFlowChain).order_by(AIFlowChain.usage_type).all()
    result = []
    for chain in chains:
        models = _resolve_chain_models(db, chain.chain or [])
        result.append(_chain_to_dict(chain, models))
    return result


@router.get("/chains/{usage_type}", response_model=AIFlowChainWithModels)
async def get_chain(usage_type: AIModelUsageType, db: Session = Depends(get_db)):
    """Get chain for specific usage_type."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nenhuma cadeia configurada para o tipo de uso '{usage_type.value}'",
        )
    models = _resolve_chain_models(db, chain.chain or [])
    return _chain_to_dict(chain, models)


@router.put("/chains/{usage_type}", response_model=AIFlowChainResponse)
async def upsert_chain(
    usage_type: AIModelUsageType,
    data: AIFlowChainBase,
    db: Session = Depends(get_db),
):
    """Create or update chain for a usage_type (upsert)."""
    for model_id in data.chain:
        model = db.query(AIModel).filter(AIModel.id == model_id).first()
        if not model:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Modelo de IA '{model_id}' não encontrado",
            )

    existing = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()

    if existing:
        existing.chain = data.chain
        existing.node_positions = data.node_positions
        existing.utility_nodes = data.utility_nodes
        existing.is_active = data.is_active
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return existing
    else:
        new_chain = AIFlowChain(
            id=uuid4(),
            usage_type=usage_type,
            chain=data.chain,
            node_positions=data.node_positions,
            utility_nodes=data.utility_nodes,
            is_active=data.is_active,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(new_chain)
        db.commit()
        db.refresh(new_chain)
        return new_chain


@router.delete("/chains/{usage_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chain(usage_type: AIModelUsageType, db: Session = Depends(get_db)):
    """Delete chain for a usage_type."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nenhuma cadeia configurada para o tipo de uso '{usage_type.value}'",
        )
    db.delete(chain)
    db.commit()
    return None


# ============================================================================
# PROMPT #124 - Feature 1: Model Metrics
# ============================================================================

@router.get("/model-metrics", response_model=ModelMetricsResponse)
async def get_model_metrics(
    model_ids: str = Query(..., description="Comma-separated model UUIDs"),
    days: int = Query(7, description="Lookback window in days"),
    db: Session = Depends(get_db),
):
    """Get execution metrics for specific models (health, success rate, latency, cost)."""
    uuid_list = [uid.strip() for uid in model_ids.split(",") if uid.strip()]
    cutoff = datetime.utcnow() - timedelta(days=days)

    results = db.query(
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
        func.count(AIExecution.id).label("total"),
        func.count(case((AIExecution.error_message.is_(None), 1))).label("successes"),
        func.count(case((AIExecution.error_message.isnot(None), 1))).label("failures"),
        func.avg(AIExecution.execution_time_ms).label("avg_latency"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
        func.max(AIExecution.created_at).label("last_exec"),
        func.count(case((AIExecution.chain_position > 1, 1))).label("fallback_count"),
    ).filter(
        AIExecution.ai_model_id.in_([UUID(uid) for uid in uuid_list]),
        AIExecution.created_at >= cutoff,
    ).group_by(
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
    ).all()

    metrics_list = []
    for row in results:
        total = row.total or 0
        successes = row.successes or 0
        success_rate = (successes / total * 100) if total > 0 else 100.0

        if success_rate >= 95:
            health = "green"
        elif success_rate >= 80:
            health = "yellow"
        else:
            health = "red"

        sum_input = row.sum_input or 0
        sum_output = row.sum_output or 0
        model_name = row.model_name or ""
        cost_info = calculate_cost(sum_input, sum_output, model_name)
        avg_cost = cost_info["total_cost"] / total if total > 0 else 0.0

        metrics_list.append(ModelMetrics(
            model_id=str(row.ai_model_id),
            model_name=model_name,
            provider=row.provider or "",
            total_executions=total,
            successful_executions=successes,
            failed_executions=row.failures or 0,
            success_rate=round(success_rate, 1),
            health=health,
            avg_latency_ms=round(row.avg_latency or 0, 1),
            avg_cost_per_call=round(avg_cost, 6),
            last_execution_at=row.last_exec,
            fallback_count=row.fallback_count or 0,
        ))

    # Add empty metrics for models with no executions
    found_ids = {m.model_id for m in metrics_list}
    for uid in uuid_list:
        if uid not in found_ids:
            model = db.query(AIModel).filter(AIModel.id == UUID(uid)).first()
            metrics_list.append(ModelMetrics(
                model_id=uid,
                model_name=model.name if model else "Unknown",
                provider=model.provider if model else "unknown",
            ))

    return ModelMetricsResponse(metrics=metrics_list, lookback_days=days)


# ============================================================================
# PROMPT #124 - Feature 3: Chain Analytics
# ============================================================================

@router.get("/chain-analytics", response_model=ChainAnalyticsResponse)
async def get_chain_analytics(
    usage_type: Optional[str] = Query(None, description="Filter by usage_type"),
    days: int = Query(30, description="Lookback window in days"),
    db: Session = Depends(get_db),
):
    """Get chain execution analytics: fallback rates, costs, failing models."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    base_filter = [
        AIExecution.chain_usage_type.isnot(None),
        AIExecution.created_at >= cutoff,
    ]
    if usage_type:
        base_filter.append(AIExecution.usage_type == usage_type)

    # Per usage_type aggregation
    usage_stats = db.query(
        AIExecution.usage_type,
        func.count(AIExecution.id).label("total"),
        func.count(case((and_(AIExecution.chain_fallback == True, AIExecution.error_message.is_(None)), 1))).label("fallback_successes"),
        func.avg(AIExecution.chain_position).label("avg_depth"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
    ).filter(*base_filter).group_by(AIExecution.usage_type).all()

    # Per model aggregation
    model_stats = db.query(
        AIExecution.usage_type,
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
        func.count(AIExecution.id).label("total"),
        func.count(case((AIExecution.error_message.isnot(None), 1))).label("failures"),
        func.avg(AIExecution.execution_time_ms).label("avg_latency"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
        func.count(case((AIExecution.chain_position == 1, 1))).label("as_primary"),
        func.count(case((AIExecution.chain_position > 1, 1))).label("as_fallback"),
    ).filter(*base_filter).group_by(
        AIExecution.usage_type,
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
    ).all()

    # Build model stats lookup
    model_stats_by_usage = {}
    worst_model = None
    worst_failure_rate = 0

    for ms in model_stats:
        ut = ms.usage_type
        total = ms.total or 0
        failures = ms.failures or 0
        failure_rate = (failures / total * 100) if total > 0 else 0.0
        sum_in = ms.sum_input or 0
        sum_out = ms.sum_output or 0
        cost_info = calculate_cost(sum_in, sum_out, ms.model_name or "")
        avg_cost = cost_info["total_cost"] / total if total > 0 else 0.0

        stats = ChainModelStats(
            model_id=str(ms.ai_model_id) if ms.ai_model_id else "",
            model_name=ms.model_name or "",
            provider=ms.provider or "",
            total_attempts=total,
            failures=failures,
            failure_rate=round(failure_rate, 1),
            avg_cost=round(avg_cost, 6),
            avg_latency_ms=round(ms.avg_latency or 0, 1),
            times_as_primary=ms.as_primary or 0,
            times_as_fallback=ms.as_fallback or 0,
        )

        model_stats_by_usage.setdefault(ut, []).append(stats)

        if failure_rate > worst_failure_rate and total >= 3:
            worst_failure_rate = failure_rate
            worst_model = stats

    # Build analytics items
    analytics = []
    total_cost_all = 0.0
    total_savings = 0.0

    for us in usage_stats:
        total = us.total or 0
        fallback_successes = us.fallback_successes or 0
        fallback_rate = (fallback_successes / total * 100) if total > 0 else 0.0
        sum_in = us.sum_input or 0
        sum_out = us.sum_output or 0

        # Use first model in list for cost estimation
        models_for_ut = model_stats_by_usage.get(us.usage_type, [])
        total_cost = 0.0
        for m in models_for_ut:
            total_cost += m.avg_cost * m.total_attempts

        total_cost_all += total_cost

        # Primary success rate
        primary_total = sum(m.times_as_primary for m in models_for_ut)
        primary_failures = sum(m.failures for m in models_for_ut if m.times_as_primary > 0)
        primary_success = ((primary_total - primary_failures) / primary_total * 100) if primary_total > 0 else 100.0

        analytics.append(ChainAnalyticsItem(
            usage_type=us.usage_type,
            total_executions=total,
            total_cost=round(total_cost, 4),
            fallback_rate=round(fallback_rate, 1),
            avg_chain_depth=round(us.avg_depth or 1, 2),
            primary_success_rate=round(primary_success, 1),
            models=models_for_ut,
            cost_savings=0.0,
        ))

    return ChainAnalyticsResponse(
        analytics=analytics,
        most_failing_model=worst_model,
        total_cost_all_chains=round(total_cost_all, 4),
        total_fallback_savings=round(total_savings, 4),
        lookback_days=days,
    )


# ============================================================================
# PROMPT #124 - Feature 4: Smart Reorder + Templates
# ============================================================================

# Model quality tiers (higher = better)
MODEL_QUALITY_TIERS = {
    "opus": 100, "claude-opus": 100, "claude-4-opus": 100,
    "sonnet": 80, "claude-sonnet": 80, "claude-4-sonnet": 80, "gpt-4o": 80, "gpt-4": 80,
    "gemini-1.5-pro": 75, "gemini-pro": 75, "command-r-plus": 75,
    "haiku": 50, "claude-haiku": 50, "gemini-1.5-flash": 50, "gemini-flash": 50,
    "gpt-3.5": 40, "command-r": 40, "command-light": 30,
    # PROMPT #289 - Ollama local model quality tiers
    "deepseek-r1:14b": 88, "deepseek-r1": 85,
    "qwen2.5-coder:14b": 86, "qwen2.5-coder": 82,
    "qwen3:14b": 85, "qwen3:8b": 70, "qwen3": 75,
    "gemma3:12b": 82, "gemma3": 78,
    "phi4:14b": 75, "phi4": 72,
    "codestral:22b": 80, "codestral": 78,
    "qwen2.5:32b": 83, "qwen2.5:14b": 78, "qwen2.5": 75,
}


def _get_quality_tier(model_name: str) -> float:
    """Get quality tier score for a model name (0-100)."""
    name_lower = model_name.lower()
    for key, score in MODEL_QUALITY_TIERS.items():
        if key in name_lower:
            return score
    return 60  # default


@router.post("/optimize-chain/{usage_type}", response_model=OptimizeChainResponse)
async def optimize_chain(
    usage_type: AIModelUsageType,
    data: OptimizeChainRequest = OptimizeChainRequest(),
    db: Session = Depends(get_db),
):
    """Analyze execution history and recommend optimal chain order."""
    chain = db.query(AIFlowChain).filter(AIFlowChain.usage_type == usage_type).first()
    if not chain or not chain.chain:
        raise HTTPException(status_code=404, detail="Nenhuma cadeia configurada para este tipo de uso")

    cutoff = datetime.utcnow() - timedelta(days=data.days)
    model_uuids = [UUID(mid) for mid in chain.chain]

    # Get per-model stats
    stats = db.query(
        AIExecution.ai_model_id,
        AIExecution.model_name,
        AIExecution.provider,
        func.count(AIExecution.id).label("total"),
        func.count(case((AIExecution.error_message.is_(None), 1))).label("successes"),
        func.avg(AIExecution.execution_time_ms).label("avg_latency"),
        func.sum(AIExecution.input_tokens).label("sum_input"),
        func.sum(AIExecution.output_tokens).label("sum_output"),
    ).filter(
        AIExecution.ai_model_id.in_(model_uuids),
        AIExecution.created_at >= cutoff,
    ).group_by(
        AIExecution.ai_model_id, AIExecution.model_name, AIExecution.provider,
    ).all()

    stats_map = {}
    for s in stats:
        stats_map[str(s.ai_model_id)] = s

    # Strategy weights
    weights = {
        "reliability": (0.6, 0.1, 0.2, 0.1),
        "cost": (0.2, 0.5, 0.1, 0.2),
        "quality": (0.2, 0.1, 0.5, 0.2),
        "balanced": (0.3, 0.25, 0.25, 0.2),
    }
    w_rel, w_cost, w_qual, w_lat = weights.get(data.strategy, weights["balanced"])

    # Calculate scores
    model_scores = []
    for mid in chain.chain:
        model = db.query(AIModel).filter(AIModel.id == UUID(mid)).first()
        if not model:
            continue

        s = stats_map.get(mid)
        if s and s.total and s.total > 0:
            success_rate = (s.successes / s.total) * 100
            avg_latency = s.avg_latency or 0
            sum_in = s.sum_input or 0
            sum_out = s.sum_output or 0
            cost_info = calculate_cost(sum_in, sum_out, s.model_name or "")
            avg_cost = cost_info["total_cost"] / s.total
        else:
            # No history — use defaults
            success_rate = 95.0
            avg_latency = 2000
            _, out_price = get_model_pricing(model.config.get("model_id", ""))
            avg_cost = out_price / 1_000_000 * 500  # estimate 500 output tokens

        quality = _get_quality_tier(model.config.get("model_id", model.name))

        # Normalize scores (0-100)
        rel_score = success_rate
        cost_score = max(0, 100 - (avg_cost * 100000))  # lower cost = higher score
        qual_score = quality
        lat_score = max(0, 100 - (avg_latency / 50))  # lower latency = higher score

        total_score = rel_score * w_rel + cost_score * w_cost + qual_score * w_qual + lat_score * w_lat

        reasoning = f"{success_rate:.1f}% success, ${avg_cost:.4f}/call, {avg_latency:.0f}ms avg"

        model_scores.append(OptimizeModelScore(
            model_id=mid,
            model_name=model.name,
            provider=model.provider,
            score=round(total_score, 2),
            reasoning=reasoning,
        ))

    # Sort by score descending
    model_scores.sort(key=lambda m: m.score, reverse=True)
    recommended = [m.model_id for m in model_scores]

    return OptimizeChainResponse(
        current_order=chain.chain,
        recommended_order=recommended,
        strategy=data.strategy,
        models=model_scores,
        estimated_improvement={},
    )


# PROMPT #209 - Recommended utility nodes per template strategy
TEMPLATE_UTILITY_NODES = {
    "high_reliability": [
        {
            "id": "retry-tmpl-1",
            "type": "retry",
            "label": "Retry",
            "enabled": True,
            "config": {"max_retries": 3, "backoff_base_ms": 1000, "backoff_multiplier": 2.0, "retry_on": ["timeout", "rate_limit", "server_error"]},
            "position": None,
        },
        {
            "id": "timeout-tmpl-1",
            "type": "timeout",
            "label": "Timeout",
            "enabled": True,
            "config": {"timeout_seconds": 120},
            "position": None,
        },
        {
            "id": "validator-tmpl-1",
            "type": "validator",
            "label": "Validator",
            "enabled": True,
            "config": {"validation_type": "not_empty", "schema": {}, "max_length": 0, "required_keywords": [], "retry_on_fail": True},
            "position": None,
        },
    ],
    "cost_optimized": [
        {
            "id": "cache-tmpl-1",
            "type": "cache",
            "label": "Cache",
            "enabled": True,
            "config": {"ttl_seconds": 86400, "cache_level": "exact", "enabled": True},
            "position": None,
        },
        {
            "id": "cost_guard-tmpl-1",
            "type": "cost_guard",
            "label": "Cost Guard",
            "enabled": True,
            "config": {"max_cost_per_call": 0.10, "daily_budget": 10.0, "monthly_budget": 100.0, "action_on_exceed": "block"},
            "position": None,
        },
        {
            "id": "prompt_transformer-tmpl-1",
            "type": "prompt_transformer",
            "label": "Prompt Transformer",
            "enabled": True,
            "config": {"transformation": "compress", "max_tokens": 4000, "language": "auto", "override_max_tokens": None, "override_temperature": None},
            "position": None,
        },
    ],
    # v2.5: 'nave' profile (Ollama-only) removed
    "high_quality": [
        {
            "id": "rag_context-tmpl-1",
            "type": "rag_context",
            "label": "RAG Context",
            "enabled": True,
            "config": {"max_results": 5, "similarity_threshold": 0.7, "include_metadata": True},
            "position": None,
        },
        {
            "id": "validator-tmpl-2",
            "type": "validator",
            "label": "Validator",
            "enabled": True,
            "config": {"validation_type": "not_empty", "schema": {}, "max_length": 0, "required_keywords": [], "retry_on_fail": True},
            "position": None,
        },
        {
            "id": "prompt_transformer-tmpl-2",
            "type": "prompt_transformer",
            "label": "Prompt Transformer",
            "enabled": True,
            "config": {"transformation": "compress", "max_tokens": 4000, "language": "auto", "override_max_tokens": None, "override_temperature": None},
            "position": None,
        },
    ],
}


@router.get("/chain-templates/{usage_type}", response_model=ChainTemplatesResponse)
async def get_chain_templates(
    usage_type: AIModelUsageType,
    db: Session = Depends(get_db),
):
    """Get pre-built chain templates for a usage_type."""
    # Get all active models for this usage_type + general
    models = db.query(AIModel).filter(
        AIModel.is_active == True,
        AIModel.usage_type.in_([usage_type, AIModelUsageType.GENERAL]),
    ).all()

    if not models:
        return ChainTemplatesResponse(templates=[])

    def model_info(m):
        return {"id": str(m.id), "name": m.name, "provider": m.provider, "model_id": m.config.get("model_id", "")}

    # Template 1: High Reliability — sort by quality tier (most capable first)
    reliability_sorted = sorted(models, key=lambda m: _get_quality_tier(m.config.get("model_id", m.name)), reverse=True)

    # Template 2: Cost Optimized — cheapest first
    def model_cost(m):
        _, out_price = get_model_pricing(m.config.get("model_id", ""))
        return out_price
    cost_sorted = sorted(models, key=model_cost)

    # Template 3: High Quality — top tier only, then rest
    quality_sorted = sorted(models, key=lambda m: _get_quality_tier(m.config.get("model_id", m.name)), reverse=True)

    templates = [
        ChainTemplate(
            id="high_reliability",
            name="Alta Confiabilidade",
            description="Modelos mais capazes primeiro, fallback para mais rápidos",
            chain=[str(m.id) for m in reliability_sorted],
            models=[model_info(m) for m in reliability_sorted],
            utility_nodes=TEMPLATE_UTILITY_NODES["high_reliability"],
        ),
        ChainTemplate(
            id="cost_optimized",
            name="Custo Mínimo",
            description="Modelos mais baratos primeiro, escalando para caros se necessário",
            chain=[str(m.id) for m in cost_sorted],
            models=[model_info(m) for m in cost_sorted],
            utility_nodes=TEMPLATE_UTILITY_NODES["cost_optimized"],
        ),
        ChainTemplate(
            id="high_quality",
            name="Alta Qualidade",
            description="Melhores modelos no topo da chain",
            chain=[str(m.id) for m in quality_sorted],
            models=[model_info(m) for m in quality_sorted],
            utility_nodes=TEMPLATE_UTILITY_NODES["high_quality"],
        ),
    ]

    # v2.5: template 'nave' (Ollama-only) removed — claudius-only lockdown.

    return ChainTemplatesResponse(templates=templates)


# ============================================================================
# PROMPT #204 - Utility Node Types Catalog
# ============================================================================

UTILITY_NODE_CATALOG = {
    "cache": {
        "type": "cache",
        "label": "Cache",
        "description": "Verifica cache Redis antes de chamar modelos de IA. Retorna resposta em cache se disponível.",
        "icon": "database",
        "color": "#8b5cf6",
        "default_config": {
            "ttl_seconds": 86400,
            "cache_level": "exact",
            "enabled": True,
        },
    },
    "rag_context": {
        "type": "rag_context",
        "label": "RAG Context",
        "description": "Expande o prompt com contexto semântico do RAG vector store. PROMPT #229: filtragem por tipo, deduplicacao, compressao de contexto e reranking.",
        "icon": "search",
        "color": "#06b6d4",
        "default_config": {
            "max_results": 5,
            "similarity_threshold": 0.7,
            "include_metadata": True,
            "filter_types": None,
            "exclude_types": None,
            "dedupe_threshold": 0.95,
            "max_context_chars": 6000,
            "compression_strategy": "key_sentences",
            "rerank_top_k": 3,
        },
    },
    "prompt_transformer": {
        "type": "prompt_transformer",
        "label": "Prompt Transformer",
        "description": "Aplica transformacoes ao prompt antes de enviar para IA (compressao, traducao, etc.). Pode sobrescrever max_tokens (limitado pelo modelo) e temperature (livre).",
        "icon": "wand",
        "color": "#f59e0b",
        "default_config": {
            "transformation": "compress",
            "max_tokens": 4000,
            "language": "auto",
            "override_max_tokens": None,
            "override_temperature": None,
        },
    },
    "router": {
        "type": "router",
        "label": "Router",
        "description": "Roteia requisicoes para diferentes cadeias de modelos baseado em condições (complexidade, custo, tópico). PROMPT #231: le query_classification dos metadados para pular modelos baratos em consultas complexas.",
        "icon": "git-branch",
        "color": "#10b981",
        "default_config": {
            "condition": "complexity",
            "tier_mapping": {
                "fast": 0,
                "balanced": "middle",
                "strong": "last",
            },
            "routes": {},
        },
    },
    "retry": {
        "type": "retry",
        "label": "Retry",
        "description": "Tenta novamente o mesmo modelo com backoff exponencial em falhas transitorias. Pulo inteligente: erros permanentes (401, 404) nunca são tentados novamente.",
        "icon": "refresh-cw",
        "color": "#3b82f6",
        "default_config": {
            "max_retries": 3,
            "backoff_base_ms": 1000,
            "backoff_multiplier": 2.0,
            "retry_on": ["timeout", "rate_limit", "server_error"],
            "skip_permanent_errors": True,
        },
    },
    "validator": {
        "type": "validator",
        "label": "Validator",
        "description": "Válida saída de IA contra regras (JSON schema, comprimento, palavras-chave, formato). Auto-reparo: tenta corrigir JSON antes de acionar retry. PROMPT #231: tipo interview_score com pontuacao estrutural 0.0-1.0.",
        "icon": "check-circle",
        "color": "#22c55e",
        "default_config": {
            "validation_type": "json",
            "schema": {},
            "max_length": 0,
            "required_keywords": [],
            "retry_on_fail": True,
            "auto_repair_json": True,
            "min_score": 0.5,
        },
    },
    "cost_guard": {
        "type": "cost_guard",
        "label": "Cost Guard",
        "description": "Bloqueia requisicoes que excederiam um limite de orçamento (por chamada ou cumulativo).",
        "icon": "shield",
        "color": "#ef4444",
        "default_config": {
            "max_cost_per_call": 0.10,
            "daily_budget": 10.0,
            "monthly_budget": 100.0,
            "action_on_exceed": "block",
        },
    },
    "rate_limiter": {
        "type": "rate_limiter",
        "label": "Rate Limiter",
        "description": "Limita o número de requisicoes por janela de tempo usando um algoritmo de janela deslizante.",
        "icon": "clock",
        "color": "#ec4899",
        "default_config": {
            "max_requests": 60,
            "window_seconds": 60,
            "action_on_exceed": "queue",
        },
    },
    "timeout": {
        "type": "timeout",
        "label": "Timeout",
        "description": "Define timeout de chamada de API em segundos. Sobrescreve padrões do modelo e do sistema. Hierarquia: No Timeout → AI Model timeout → System Settings padrão.",
        "icon": "timer",
        "color": "#f97316",
        "default_config": {
            "timeout_seconds": 120,
        },
    },
    "prompt_queue": {
        "type": "prompt_queue",
        "label": "Prompt Queue",
        "description": "Fila de prioridade de orquestracao. Ordena prompts por hierarquia, prioridade, dependencias e idade. Garante que cards pais executem antes dos filhos para consistencia de código.",
        "icon": "list-ordered",
        "color": "#8b5cf6",
        "default_config": {
            "strategy": "balanced",
            "max_concurrent": 1,
            "auto_populate": True,
        },
    },
    "prompt_node": {
        "type": "prompt_node",
        "label": "Prompt Node",
        "description": "Prompt estruturado reutilizável para ORBIT AI. Armazena referência a arquivo YAML com instruções que podem ser executadas manualmente ou via automação.",
        "icon": "file-text",
        "color": "#6366f1",
        "default_config": {
            "prompt_yaml": "",
            "repeat": 1,
            "description": "",
        },
    },
}


@router.get("/utility-node-types")
async def list_utility_node_types():
    """List all available utility node types with their default configurations."""
    return {"node_types": list(UTILITY_NODE_CATALOG.values())}


# ============================================================================
# AI Flow Profiles - Named, Versioned Flow Configurations
# ============================================================================

@router.get("/profiles", response_model=List[AIFlowProfileResponse])
async def list_profiles(db: Session = Depends(get_db)):
    """List all AI Flow profiles."""
    profiles = db.query(AIFlowProfile).order_by(
        AIFlowProfile.is_active.desc(),
        AIFlowProfile.updated_at.desc(),
    ).all()
    return profiles


@router.post("/profiles", response_model=AIFlowProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_profile(
    data: AIFlowProfileCreate,
    db: Session = Depends(get_db),
):
    """Create a new AI Flow profile."""
    profile = AIFlowProfile(
        id=uuid4(),
        name=data.name,
        usage_type=data.usage_type,
        version=1,
        chain=data.chain or [],
        utility_nodes=data.utility_nodes,
        node_positions=data.node_positions,
        subflows={k: v.model_dump() for k, v in (data.subflows or {}).items()},
        is_active=False,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    logger.info(f"✅ Created AI Flow profile: {profile.name} ({profile.usage_type})")
    return profile


@router.put("/profiles/{profile_id}", response_model=AIFlowProfileResponse)
async def update_profile(
    profile_id: UUID,
    data: AIFlowProfileUpdate,
    db: Session = Depends(get_db),
):
    """Update an AI Flow profile. Increments version automatically."""
    profile = db.query(AIFlowProfile).filter(AIFlowProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    if data.name is not None:
        profile.name = data.name
    if data.usage_type is not None:
        profile.usage_type = data.usage_type
    if data.chain is not None:
        profile.chain = data.chain
    if data.utility_nodes is not None:
        profile.utility_nodes = data.utility_nodes
    if data.node_positions is not None:
        profile.node_positions = data.node_positions
    if data.subflows is not None:
        profile.subflows = {k: v.model_dump() for k, v in data.subflows.items()}

    profile.version += 1
    db.commit()
    db.refresh(profile)
    logger.info(f"✅ Updated AI Flow profile: {profile.name} v{profile.version}")
    return profile


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_id: UUID,
    db: Session = Depends(get_db),
):
    """Delete an AI Flow profile."""
    profile = db.query(AIFlowProfile).filter(AIFlowProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    db.delete(profile)
    db.commit()
    logger.info(f"🗑️ Deleted AI Flow profile: {profile.name}")


@router.post("/profiles/{profile_id}/activate", response_model=AIFlowProfileResponse)
async def activate_profile(
    profile_id: UUID,
    db: Session = Depends(get_db),
):
    """Activate a profile. Deactivates all other profiles with the same usage_type."""
    profile = db.query(AIFlowProfile).filter(AIFlowProfile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Deactivate all other profiles with the same usage_type
    db.query(AIFlowProfile).filter(
        AIFlowProfile.usage_type == profile.usage_type,
        AIFlowProfile.id != profile_id,
    ).update({"is_active": False})

    profile.is_active = True
    db.commit()
    db.refresh(profile)

    # Also sync to ai_flow_chains for backward compatibility
    existing_chain = db.query(AIFlowChain).filter(
        AIFlowChain.usage_type == profile.usage_type
    ).first()
    if existing_chain:
        existing_chain.chain = profile.chain
        existing_chain.utility_nodes = profile.utility_nodes
        existing_chain.node_positions = profile.node_positions
        existing_chain.is_active = True
        db.commit()

    logger.info(f"✅ Activated AI Flow profile: {profile.name} ({profile.usage_type})")
    return profile
