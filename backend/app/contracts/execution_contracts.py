"""
Execution Contracts - Auto-generated from YAML contracts.
Source: backend/app/contracts/execution/ (3 files)
"""
from typing import TypedDict, Dict


# --- execution/context_limits.yaml ---

EXECUTION_CONTEXT_LIMITS_SYSTEM = """"""

EXECUTION_CONTEXT_LIMITS_USER = """"""

EXECUTION_CONTEXT_LIMITS_DATA = {'message_limits': {'simple': 2, 'moderate': 6, 'complex': 12}, 'system_prompt_limits': {'simple': 500, 'moderate': 2000, 'complex': 0}, 'code_block_limits': {'simple': 500, 'moderate': 2000, 'complex': 0}, 'code_truncate_head': 15, 'code_truncate_tail': 10}

EXECUTION_CONTEXT_LIMITS_RULES = {'constraints': [{'id': 'C1', 'description': 'Nível simples tem os limites mais restritivos', 'condition': 'simple.limits < moderate.limits < complex.limits'}, {'id': 'C2', 'description': 'Nível complexo permite ilimitado para a maioria dos recursos', 'condition': 'complex.system_prompt == 0 AND complex.code_block == 0'}]}

EXECUTION_CONTEXT_LIMITS_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado do general_context_builder.py - dicts hardcoded de limites'}]}


# --- execution/similarity_thresholds.yaml ---

EXECUTION_SIMILARITY_THRESHOLDS_SYSTEM = """"""

EXECUTION_SIMILARITY_THRESHOLDS_USER = """"""

EXECUTION_SIMILARITY_THRESHOLDS_DATA = {'thresholds': {'exact_match_cache': 0.95, 'modification_detection': 0.9, 'card_deduplication': 0.85, 'rag_relevance': 0.85, 'backlog_deduplication': 0.6, 'memory_search': 0.5, 'no_filter': 0.0}}

EXECUTION_SIMILARITY_THRESHOLDS_RULES = {'constraints': [{'id': 'C1', 'description': 'Limiares mais altos = correspondencia mais rigorosa', 'condition': 'exact_match_cache > modification_detection > card_deduplication > backlog_deduplication > memory_search'}]}

EXECUTION_SIMILARITY_THRESHOLDS_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado de 9+ arquivos com limiares de similaridade hardcoded'}]}


# --- execution/token_budgets.yaml ---

EXECUTION_TOKEN_BUDGETS_SYSTEM = """"""

EXECUTION_TOKEN_BUDGETS_USER = """"""

EXECUTION_TOKEN_BUDGETS_DATA = {'default_budget': 2500, 'story_point_budgets': {1: 2000, 2: 2000, 3: 2500, 5: 3000, 8: 4000, 13: 5000, 21: 6000}, 'type_budgets': {'task': 2500, 'bug': 2000, 'story': 4000, 'epic': 6000}}

EXECUTION_TOKEN_BUDGETS_RULES = {'constraints': [{'id': 'C1', 'description': 'Orçamento e sempre o máximo entre story_point e type_budget', 'condition': 'budget = max(story_point_budget, type_budget, default_budget)'}, {'id': 'C2', 'description': 'Story points usam o número Fibonacci mais próximo', 'condition': 'closest = min(fibonacci_keys, key=lambda x: abs(x - story_points))'}]}

EXECUTION_TOKEN_BUDGETS_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado do budget_manager.py - dicts hardcoded de orçamento'}]}



class SimilarityThresholds(TypedDict):
    exact_match_cache: float
    modification_detection: float
    card_deduplication: float
    rag_relevance: float
    backlog_deduplication: float
    memory_search: float
    no_filter: float


SIMILARITY_THRESHOLDS: SimilarityThresholds = {
    "exact_match_cache": 0.95,
    "modification_detection": 0.90,
    "card_deduplication": 0.85,
    "rag_relevance": 0.85,
    "backlog_deduplication": 0.60,
    "memory_search": 0.50,
    "no_filter": 0.0,
}


class ContextLevelLimits(TypedDict):
    simple: int
    moderate: int
    complex: int


class ContextLimitsConfig(TypedDict):
    message_limits: ContextLevelLimits
    system_prompt_limits: ContextLevelLimits
    code_block_limits: ContextLevelLimits
    code_truncate_head: int
    code_truncate_tail: int


CONTEXT_LIMITS: ContextLimitsConfig = {
    "message_limits": {"simple": 2, "moderate": 6, "complex": 12},
    "system_prompt_limits": {"simple": 500, "moderate": 2000, "complex": 0},
    "code_block_limits": {"simple": 500, "moderate": 2000, "complex": 0},
    "code_truncate_head": 15,
    "code_truncate_tail": 10,
}


class TokenBudgetsConfig(TypedDict):
    default_budget: int
    story_point_budgets: Dict[int, int]
    type_budgets: Dict[str, int]


TOKEN_BUDGETS: TokenBudgetsConfig = {
    "default_budget": 2500,
    "story_point_budgets": {1: 2000, 2: 2000, 3: 2500, 5: 3000, 8: 4000, 13: 5000, 21: 6000},
    "type_budgets": {"task": 2500, "bug": 2000, "story": 4000, "epic": 6000},
}

CONTRACTS = {
    "execution/context_limits": {"system": EXECUTION_CONTEXT_LIMITS_SYSTEM, "user": EXECUTION_CONTEXT_LIMITS_USER, "usage_type": "_config", "data": EXECUTION_CONTEXT_LIMITS_DATA},
    "execution/similarity_thresholds": {"system": EXECUTION_SIMILARITY_THRESHOLDS_SYSTEM, "user": EXECUTION_SIMILARITY_THRESHOLDS_USER, "usage_type": "_config", "data": EXECUTION_SIMILARITY_THRESHOLDS_DATA},
    "execution/token_budgets": {"system": EXECUTION_TOKEN_BUDGETS_SYSTEM, "user": EXECUTION_TOKEN_BUDGETS_USER, "usage_type": "_config", "data": EXECUTION_TOKEN_BUDGETS_DATA},
}
