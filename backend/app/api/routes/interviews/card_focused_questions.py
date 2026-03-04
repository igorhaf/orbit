"""
Card-Focused Interview Questions - PROMPT #98
Sistema de entrevistas para criação de Stories, Tasks e Subtasks
Cada card tem motivação/tipo que direciona as perguntas da IA

Questões Fixas:
- Q1: Motivação/Tipo do Card (bug, feature, bugfix, design, documentation, etc.)
- Q2: Título da Demanda
- Q3: Descrição da Demanda
- Q4+: Perguntas de IA contextualizadas baseadas no tipo de motivação

O tipo escolhido em Q1 direciona as perguntas que a IA fará em Q4+.
"""

from datetime import datetime
from sqlalchemy.orm import Session
from typing import Optional, Dict

from app.models.project import Project
from app.models.task import Task


# Motivação/Tipos disponíveis para cards
CARD_MOTIVATION_TYPES = [
    {
        "id": "bug",
        "label": "Bug Fix",
        "value": "bug",
        "icon": "bug",
        "description": "Corrigir um problema ou erro existente",
        "ai_focus": "Reprodução, ambiente, comportamento esperado vs atual"
    },
    {
        "id": "feature",
        "label": "New Feature",
        "value": "feature",
        "icon": "sparkles",
        "description": "Adicionar uma nova funcionalidade",
        "ai_focus": "User story, critérios de aceitação, integrações"
    },
    {
        "id": "bugfix",
        "label": "Bug Fix Refactoring",
        "value": "bugfix",
        "icon": "wrench",
        "description": "Corrigir e refatorar código problemático",
        "ai_focus": "Reprodução, refactoring scope, comportamento preservado"
    },
    {
        "id": "design",
        "label": "Design/Architecture",
        "value": "design",
        "icon": "blocks",
        "description": "Melhorar design ou arquitetura",
        "ai_focus": "Problemas atuais, padrões desejados, documentação"
    },
    {
        "id": "documentation",
        "label": "Documentation",
        "value": "documentation",
        "icon": "document",
        "description": "Criar ou melhorar documentação",
        "ai_focus": "Escopo, estrutura, público-alvo"
    },
    {
        "id": "enhancement",
        "label": "Enhancement",
        "value": "enhancement",
        "icon": "bolt",
        "description": "Melhorar uma funcionalidade existente",
        "ai_focus": "Funcionalidade atual, limitações, melhoria desejada"
    },
    {
        "id": "refactor",
        "label": "Refactoring",
        "value": "refactor",
        "icon": "puzzle",
        "description": "Melhorar estrutura de código sem alterar funcionalidade",
        "ai_focus": "Código atual, problemas, objetivo final"
    },
    {
        "id": "testing",
        "label": "Testing/QA",
        "value": "testing",
        "icon": "checkCircle",
        "description": "Adicionar testes ou melhorar cobertura",
        "ai_focus": "Cobertura atual, gaps, estratégia de teste"
    },
    {
        "id": "optimization",
        "label": "Optimization",
        "value": "optimization",
        "icon": "cog",
        "description": "Otimizar performance ou recursos",
        "ai_focus": "Gargalos atuais, métricas alvo, impacto"
    },
    {
        "id": "security",
        "label": "Security",
        "value": "security",
        "icon": "lock",
        "description": "Melhorias de segurança",
        "ai_focus": "Vulnerabilidades, ameaças, mitigações"
    }
]


def get_card_motivation_types() -> list:
    """
    Retorna lista de tipos de motivação disponíveis para cards.

    Returns:
        Lista de dicts com: id, label, value, description, ai_focus
    """
    return CARD_MOTIVATION_TYPES


def get_card_focused_fixed_question(
    question_number: int,
    project: Project,
    db: Session,
    parent_card: Optional[Task] = None,
    previous_answers: Dict = None
) -> Optional[dict]:
    """
    Retorna questões fixas para CARD_FOCUSED interview mode.

    PROMPT #98 - Card-Focused Interview Mode

    Q1: Motivação/Tipo do Card (bug, feature, bugfix, design, etc.) - single_choice
    Q2: Título da Demanda - text
    Q3: Descrição da Demanda - text
    Q4+: Perguntas de IA contextualizadas (returns None para trigger fase IA)

    Args:
        question_number: Número da pergunta
        project: Instância do projeto
        db: Sessão do banco de dados
        parent_card: Card pai (Epic, Story ou Task) para contexto
        previous_answers: Dict com respostas anteriores

    Returns:
        Dict com pergunta, ou None se além de Q3 (triggers fase IA)
    """
    previous_answers = previous_answers or {}

    # Q1: Motivação/Tipo do Card
    if question_number == 1:
        parent_context = ""
        if parent_card:
            parent_type = parent_card.item_type or "card"
            parent_context = f"\n\nCard pai: {parent_card.title} ({parent_type})"

        return {
            "role": "assistant",
            "content": f"Pergunta 1: Qual é a motivação/tipo deste card?{parent_context}\n\nSelecione o tipo de trabalho:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-card-focused",
            "question_type": "single_choice",
            "question_number": 1,
            "options": {
                "type": "single",
                "choices": get_card_motivation_types()
            }
        }

    # Q2: Título da Demanda
    elif question_number == 2:
        return {
            "role": "assistant",
            "content": "Pergunta 2: Qual é o título desta demanda?\n\nDigite um título claro e descritivo.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-card-focused",
            "question_type": "text",
            "question_number": 2,
            "prefilled_value": parent_card.title if parent_card else ""
        }

    # Q3: Descrição da Demanda
    elif question_number == 3:
        return {
            "role": "assistant",
            "content": "Pergunta 3: Descreva brevemente a demanda.\n\nForneça detalhes sobre o que precisa ser feito e qual problema resolve.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-card-focused",
            "question_type": "text",
            "question_number": 3,
            "prefilled_value": parent_card.description if parent_card else ""
        }

    # Q4+: Sem mais perguntas fixas - move para perguntas contextuais da IA
    else:
        return None


def count_fixed_questions_card_focused(system_type: str = None) -> int:
    """
    Retorna o número total de perguntas fixas para card_focused mode.

    PROMPT #98 - Card-Focused Mode
    Q1: Motivação/Tipo
    Q2: Título
    Q3: Descrição

    Args:
        system_type: Não usado - mantido por compatibilidade

    Returns:
        Always 3 (Q1: Tipo, Q2: Título, Q3: Descrição)
    """
    return 3


def is_fixed_question_complete_card_focused(conversation_data: list, system_type: str = None) -> bool:
    """
    Verifica se todas as perguntas fixas foram respondidas.

    Args:
        conversation_data: Lista de mensagens da conversa
        system_type: Não usado - mantido por compatibilidade

    Returns:
        True se todas as 3 perguntas fixas foram respondidas
    """
    total_fixed = count_fixed_questions_card_focused()

    # Conta quantas perguntas fixas foram feitas
    fixed_count = sum(
        1 for msg in conversation_data
        if msg.get('model') == 'system/fixed-question-card-focused' and msg.get('role') == 'assistant'
    )

    return fixed_count >= total_fixed


def get_motivation_type_from_answers(previous_answers: Dict) -> Optional[str]:
    """
    Extrai o tipo de motivação das respostas anteriores.

    Args:
        previous_answers: Dict com respostas anteriores

    Returns:
        Tipo de motivação (bug, feature, bugfix, design, etc.) ou None
    """
    # Tenta encontrar a resposta da Q1 em diferentes formatos
    if "question_1" in previous_answers:
        return previous_answers["question_1"].lower()
    if "motivation_type" in previous_answers:
        return previous_answers["motivation_type"].lower()
    if "card_type" in previous_answers:
        return previous_answers["card_type"].lower()

    return None
