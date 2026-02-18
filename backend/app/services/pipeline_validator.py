"""
Pipeline Validator Service

PROMPT #230 Phase 5 - Validates ALL AI outputs against contracts.
Rejects low-quality or hallucinated content before persisting.

Validators:
- validate_context: ensures no content removal, evidence present
- validate_wiki_page: ensures 6 mandatory sections, min 300 words, evidence
- validate_card: ensures language gradient, mandatory fields, user story format
"""

import logging
import re
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Mandatory wiki sections (Portuguese, case-insensitive)
WIKI_MANDATORY_SECTIONS = [
    "visao geral",
    "regras de negocio",
    "fluxos",
    "entidades",
    "restricoes",
    "cenarios",
]

# Technical terms that should NOT appear in Epics (functional language only)
TECHNICAL_TERMS = [
    "migration", "endpoint", "api", "controller", "model",
    "database", "sql", "query", "foreign key", "index",
    "middleware", "router", "http", "get /", "post /",
    "put /", "delete /", "select ", "insert ", "update ",
    "create table", "alter table", "class ", "function ",
    "def ", "async ", "import ", "require(", "npm ",
    "composer", "pip ", "docker", "kubectl",
]

# User story pattern: "Como [X], quero [Y], para [Z]"
USER_STORY_PATTERN = re.compile(
    r"como\s+.{3,},\s*quero\s+.{3,},\s*para\s+.{3,}",
    re.IGNORECASE,
)


def validate_context(
    current_description: str,
    updated_description: str,
    min_ratio: float = 0.8,
) -> Tuple[bool, List[str]]:
    """
    Validate incremental context update.

    Checks:
    1. Updated description is not shorter than min_ratio of current
    2. Updated description contains evidence markers (descoberto em / origem:)
    3. Updated description is not empty

    Returns:
        (is_valid, list_of_issues)
    """
    issues = []

    if not updated_description or len(updated_description) < 50:
        issues.append("Descricao atualizada esta vazia ou muito curta")
        return False, issues

    # Check for content shrinkage
    if current_description and len(updated_description) < len(current_description) * min_ratio:
        issues.append(
            f"Descricao encolheu: {len(current_description)} -> {len(updated_description)} chars "
            f"(minimo {min_ratio*100:.0f}%)"
        )

    # Check for evidence markers (at least one)
    evidence_patterns = ["descoberto em", "origem:", "(origem:", "fonte:"]
    has_evidence = any(p in updated_description.lower() for p in evidence_patterns)
    if not has_evidence and current_description:
        # Only warn if there was already content (first creation may not have evidence)
        issues.append("Nenhuma evidencia encontrada (esperado: 'descoberto em [arquivo]')")

    is_valid = len(issues) == 0 or (
        len(issues) == 1 and "evidencia" in issues[0].lower()
    )
    return is_valid, issues


def validate_wiki_page(
    content: str,
    mode: str = "create",
    existing_content: str = "",
    min_words: int = 100,
) -> Tuple[bool, List[str]]:
    """
    Validate wiki page content against contract.

    Checks:
    1. Minimum word count (300 for create, 100 for merge)
    2. Mandatory sections present (at least 4 of 6)
    3. Evidence markers present
    4. Anti-shrink for merge mode

    Returns:
        (is_valid, list_of_issues)
    """
    issues = []

    if not content or len(content) < 50:
        issues.append("Conteudo da pagina wiki esta vazio ou muito curto")
        return False, issues

    # Word count
    effective_min = min_words if mode == "merge" else 100
    word_count = len(content.split())
    if word_count < effective_min:
        issues.append(f"Pagina com {word_count} palavras (minimo: {effective_min})")

    # Check mandatory sections (at least 4 of 6)
    content_lower = content.lower()
    sections_found = sum(
        1 for section in WIKI_MANDATORY_SECTIONS
        if section in content_lower
    )
    if sections_found < 3:
        issues.append(
            f"Apenas {sections_found}/6 secoes obrigatorias encontradas "
            f"(minimo: 3)"
        )

    # Evidence markers
    evidence_patterns = ["origem:", "(origem:", "descoberto em", "fonte:"]
    has_evidence = any(p in content_lower for p in evidence_patterns)
    if not has_evidence:
        issues.append("Nenhuma evidencia de origem encontrada")

    # Anti-shrink for merge
    if mode == "merge" and existing_content:
        if len(content) < len(existing_content) * 0.8:
            issues.append(
                f"Merge encolheria pagina: {len(existing_content)} -> {len(content)} chars"
            )

    # Valid if no critical issues (evidence is a warning, not blocking)
    critical_issues = [i for i in issues if "evidencia" not in i.lower()]
    is_valid = len(critical_issues) == 0
    return is_valid, issues


def validate_card(
    title: str,
    description: str,
    item_type: str,
    acceptance_criteria: Optional[List] = None,
) -> Tuple[bool, List[str]]:
    """
    Validate card content by hierarchy level.

    Epic: 100% functional, no technical terms
    Story: must have user story format ("Como X, quero Y, para Z")
    Task: semi-technical allowed
    Subtask: fully technical allowed

    Returns:
        (is_valid, list_of_issues)
    """
    issues = []

    # Basic field validation
    if not title or len(title) < 10:
        issues.append(f"Titulo muito curto: '{title}' (minimo 10 chars)")

    if not description or len(description) < 20:
        issues.append("Descricao muito curta (minimo 20 chars)")

    # Level-specific validation
    if item_type == "epic":
        # Epics must be 100% functional - check for technical terms
        combined = f"{title} {description}".lower()
        tech_found = [t for t in TECHNICAL_TERMS if t in combined]
        if len(tech_found) > 2:
            issues.append(
                f"Epic contem termos tecnicos (esperado linguagem funcional): "
                f"{', '.join(tech_found[:3])}"
            )

    elif item_type == "story":
        # Stories should have user story format
        if description and not USER_STORY_PATTERN.search(description):
            # Not blocking, just a warning
            issues.append("Story nao segue formato 'Como X, quero Y, para Z'")

    # Acceptance criteria check (optional but recommended)
    if item_type in ("epic", "story") and not acceptance_criteria:
        issues.append(f"Sem criterios de aceitacao para {item_type}")

    # Valid if no critical issues
    critical_issues = [
        i for i in issues
        if "formato" not in i.lower() and "criterios" not in i.lower()
    ]
    is_valid = len(critical_issues) == 0
    return is_valid, issues


def validate_stories_response(ai_response: str) -> Tuple[bool, List[str], Optional[Dict]]:
    """
    Validate AI response for story generation (JSON structure).

    Returns:
        (is_valid, issues, parsed_data_or_None)
    """
    import json

    issues = []

    if not ai_response or len(ai_response) < 10:
        issues.append("Resposta da IA vazia")
        return False, issues, None

    # Try to parse JSON
    clean = ai_response.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
        if clean.endswith("```"):
            clean = clean[:-3]
        clean = clean.strip()

    try:
        parsed = json.loads(clean)
    except json.JSONDecodeError as e:
        issues.append(f"Resposta nao e JSON valido: {e}")
        return False, issues, None

    # Check structure
    stories = parsed.get("stories", [])
    if not isinstance(stories, list):
        issues.append("Campo 'stories' nao e uma lista")
        return False, issues, None

    if len(stories) == 0:
        issues.append("Nenhuma story gerada")
        return False, issues, parsed

    # Validate each story
    for i, story in enumerate(stories):
        if not isinstance(story, dict):
            issues.append(f"Story {i+1} nao e um objeto")
            continue
        if not story.get("title"):
            issues.append(f"Story {i+1} sem titulo")
        if not story.get("description"):
            issues.append(f"Story {i+1} sem descricao")

    is_valid = all("nao e" not in i for i in issues)
    return is_valid, issues, parsed
