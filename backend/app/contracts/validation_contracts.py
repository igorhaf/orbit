"""
Validation Contracts - Auto-generated from YAML contracts.
Source: backend/app/contracts/validation/ (1 files)
"""
from typing import TypedDict, List, Dict


# --- validation/response_rules.yaml ---

VALIDATION_RESPONSE_RULES_SYSTEM = """"""

VALIDATION_RESPONSE_RULES_USER = """"""

VALIDATION_RESPONSE_RULES_DATA = {'error_patterns': ['rate\\s+limit\\s+(?:exceeded|reached|error)', '(?:internal\\s+)?server\\s+error', 'API\\s+(?:key|token)\\s+(?:invalid|expired|missing)', 'quota\\s+(?:exceeded|exhausted)', '(?:connection|timeout)\\s+(?:error|refused|timed\\s+out)', 'HTTPError|HTTPException|status_code\\s*[:=]\\s*[45]\\d\\d'], 'refusal_patterns': ["^I(?:'m| am) (?:sorry|unable|not able)", '^(?:Desculpe|Não posso|Não consigo|Infelizmente)', "I (?:cannot|can't|am unable to) (?:help|assist|provide|generate|create)"], 'min_response_chars': {'simple': 10, 'moderate': 30, 'complex': 50}, 'max_response_chars': {'simple': 2000, 'moderate': 8000, 'complex': 0}, 'pt_markers': ['de', 'da', 'do', 'das', 'dos', 'em', False, 'na', 'nos', 'nas', 'para', 'por', 'com', 'sem', 'sobre', 'entre', 'depois', 'antes', 'que', 'uma', 'um', 'seu', 'sua', 'seus', 'suas', 'este', 'esta', 'esse', 'essa', 'isso', 'isto', 'aquilo'], 'en_markers': ['the', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'this', 'that', 'these', 'those', 'with', 'from', 'into', 'upon', 'about', 'between', 'through', 'during', 'before', 'after']}

VALIDATION_RESPONSE_RULES_RULES = {'constraints': [{'id': 'C1', 'description': 'Todos os padrões usam regex case-insensitive', 'condition': 're.IGNORECASE applied to all patterns'}, {'id': 'C2', 'description': 'Padrões de recusa verificam apenas o início da resposta', 'condition': 'pattern starts with ^ anchor'}]}

VALIDATION_RESPONSE_RULES_GOVERNANCE = {'status': 'active', 'owner': 'ORBIT Core Team', 'effective_date': '2026-02-13', 'change_log': [{'version': 1, 'date': '2026-02-13', 'author': 'Claude', 'changes': 'Externalizado do general_response_validator.py - padrões hardcoded'}]}



class MinResponseChars(TypedDict):
    simple: int
    moderate: int
    complex: int


class MaxResponseChars(TypedDict):
    simple: int
    moderate: int
    complex: int


class ResponseRulesData(TypedDict):
    error_patterns: List[str]
    refusal_patterns: List[str]
    min_response_chars: MinResponseChars
    max_response_chars: MaxResponseChars
    pt_markers: List[str]
    en_markers: List[str]


RESPONSE_RULES: ResponseRulesData = VALIDATION_RESPONSE_RULES_DATA  # type: ignore[assignment]

CONTRACTS = {
    "validation/response_rules": {"system": VALIDATION_RESPONSE_RULES_SYSTEM, "user": VALIDATION_RESPONSE_RULES_USER, "usage_type": "_config", "data": VALIDATION_RESPONSE_RULES_DATA},
}
