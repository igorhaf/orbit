"""
Fixed Interview Questions
PROMPT #69 - Refactor interviews.py

Functions for generating fixed questions (Q1-Q7 for requirements mode, Q1 for task-focused mode).
Questions have dynamic options pulled from specs database.
"""

from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.project import Project
from app.models.spec import Spec


def get_specs_for_category(db: Session, category: str) -> list:
    """
    Get available frameworks from specs for a specific category.
    Returns list of choices formatted for interview options.

    DYNAMIC SYSTEM: Options come from specs table, not hardcoded.
    """
    # Query distinct frameworks for this category
    specs = db.query(
        Spec.name,
        func.count(Spec.id).label('count')
    ).filter(
        Spec.category == category,
        Spec.is_active == True
    ).group_by(Spec.name).all()

    # Label mappings (same as in specs.py for consistency)
    labels = {
        # Backend
        'laravel': 'Laravel (PHP)',
        'django': 'Django (Python)',
        'fastapi': 'FastAPI (Python)',
        'express': 'Express.js (Node.js)',

        # Database
        'postgresql': 'PostgreSQL',
        'mysql': 'MySQL',
        'mongodb': 'MongoDB',
        'sqlite': 'SQLite',

        # Frontend
        'nextjs': 'Next.js (React)',
        'react': 'React',
        'vue': 'Vue.js',
        'angular': 'Angular',

        # CSS
        'tailwind': 'Tailwind CSS',
        'bootstrap': 'Bootstrap',
        'materialui': 'Material UI',
        'custom': 'CSS Customizado',
    }

    # Format choices
    choices = []
    for name, count in specs:
        label = labels.get(name, name.title())
        choices.append({
            "id": name,
            "label": label,
            "value": name
        })

    return choices


def get_fixed_question(question_number: int, project: Project, db: Session) -> dict:
    """
    Returns fixed questions with DYNAMIC options from specs.
    Questions 1-2: Title and Description (text input, prefilled)
    Questions 3-7: Stack questions (single choice, OPTIONS FROM SPECS)

    PROMPT #57 - Fixed Questions Without AI
    PROMPT #67 - Mobile Support (Q7 added)
    DYNAMIC SYSTEM: Questions 3-7 pull options from specs table
    """

    # Questions 1-2: Static (Title and Description)
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 1: Qual é o título do projeto?\n\nDigite o título do seu projeto.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.name,
            "question_number": 1
        }

    if question_number == 2:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 2: Descreva brevemente o objetivo do projeto.\n\nForneça uma breve descrição do que o projeto faz.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "text",
            "prefilled_value": project.description,
            "question_number": 2
        }

    # Questions 3-7: DYNAMIC (Stack - from specs)
    category_map = {
        3: ("backend", "❓ Pergunta 3: Qual framework de backend você vai usar?"),
        4: ("database", "❓ Pergunta 4: Qual banco de dados você vai usar?"),
        5: ("frontend", "❓ Pergunta 5: Qual framework de frontend você vai usar?"),
        6: ("css", "❓ Pergunta 6: Qual framework CSS você vai usar?"),
        7: ("mobile", "📱 Pergunta 7: Qual framework mobile você deseja usar?")
    }

    if question_number in category_map:
        category, question_text = category_map[question_number]

        # Get dynamic choices from specs
        choices = get_specs_for_category(db, category)

        # Build options text for display (for backward compatibility with text parsing)
        # NOTE: We don't include "◉ Escolha uma opção" anymore because MessageParser
        # incorrectly treats it as an option (it starts with ◉ symbol)
        options_text = "\n".join([f"○ {choice['label']}" for choice in choices])

        return {
            "role": "assistant",
            "content": f"{question_text}\n\n{options_text}\n\nPor favor, escolha uma das opções acima.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question",
            "question_type": "single_choice",
            "question_number": question_number,
            "options": {
                "type": "single",
                "choices": choices
            }
        }

    return None


def get_fixed_question_task_focused(question_number: int, project: Project, db: Session) -> dict:
    """
    Returns fixed questions for TASK-FOCUSED interviews.
    PROMPT #68 - Dual-Mode Interview System

    Task-focused interviews skip stack questions and focus on task details.
    Q1: Task Type Selection (bug/feature/refactor/enhancement)
    Q2+: AI-generated based on selected task type

    Args:
        question_number: Question number (only Q1 is fixed for task-focused)
        project: Project instance
        db: Database session

    Returns:
        Message dict with question, or None if not a fixed question
    """
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "❓ Que tipo de trabalho você precisa fazer?\n\nSelecione o tipo de tarefa:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-task-focused",
            "question_type": "single_choice",
            "question_number": 1,
            "options": {
                "type": "single",
                "choices": [
                    {
                        "id": "bug",
                        "label": "🐛 Bug Fix",
                        "value": "bug",
                        "description": "Corrigir um problema ou erro existente"
                    },
                    {
                        "id": "feature",
                        "label": "✨ New Feature",
                        "value": "feature",
                        "description": "Adicionar uma nova funcionalidade"
                    },
                    {
                        "id": "refactor",
                        "label": "🔧 Refactoring",
                        "value": "refactor",
                        "description": "Melhorar a estrutura do código sem alterar funcionalidade"
                    },
                    {
                        "id": "enhancement",
                        "label": "⚡ Enhancement",
                        "value": "enhancement",
                        "description": "Melhorar uma funcionalidade existente"
                    }
                ]
            }
        }

    # Q2+ are AI-generated, not fixed
    return None


def get_fixed_question_meta_prompt(question_number: int, project: Project, db: Session) -> dict:
    """
    Returns fixed questions for META PROMPT interviews.
    PROMPT #76 - Meta Prompt Feature
    PROMPT #77 - Topic Selection (Q16)
    PROMPT #79 - Stack Questions Added (Q1-Q7)

    Meta prompt is ALWAYS the first interview for any project.
    It gathers comprehensive information to generate the entire project hierarchy
    (Epics → Stories → Tasks → Subtasks) with atomic prompts.

    Fixed Questions (Q1-Q16):
    - Q1: Project Title
    - Q2: Project Description
    - Q3: Backend Framework
    - Q4: Database
    - Q5: Frontend Framework
    - Q6: CSS Framework
    - Q7: Mobile Framework
    - Q8: Project Vision & Problem Statement
    - Q9: Main Features/Modules (multiple choice)
    - Q10: User Roles & Permissions
    - Q11: Key Business Rules & Logic
    - Q12: Data & Entities
    - Q13: Success Criteria & Goals
    - Q14: Technical Constraints/Preferences
    - Q15: Project Scope & Priorities (MVP)
    - Q16: Focus Topics (PROMPT #77)

    After Q16, AI can ask contextual questions to clarify details.

    Args:
        question_number: Question number (Q1-Q16 are fixed for meta prompt)
        project: Project instance
        db: Database session

    Returns:
        Message dict with question, or None if beyond fixed questions
    """

    # Q1-Q2: Project Info (Title and Description)
    if question_number == 1:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 1: Qual é o título do projeto?\n\nDigite o título do seu projeto.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 1,
            "prefilled_value": project.name or ""
        }

    elif question_number == 2:
        return {
            "role": "assistant",
            "content": "❓ Pergunta 2: Descreva brevemente o objetivo do projeto.\n\nForneça uma breve descrição do que o projeto faz.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 2,
            "prefilled_value": project.description or ""
        }

    # Q3-Q7: Stack Questions (Backend, Database, Frontend, CSS, Mobile)
    elif question_number in [3, 4, 5, 6, 7]:
        category_map = {
            3: ("backend", "❓ Pergunta 3: Qual framework de backend você vai usar?"),
            4: ("database", "❓ Pergunta 4: Qual banco de dados você vai usar?"),
            5: ("frontend", "❓ Pergunta 5: Qual framework de frontend você vai usar?"),
            6: ("css", "❓ Pergunta 6: Qual framework CSS você vai usar?"),
            7: ("mobile", "📱 Pergunta 7: Qual framework mobile você deseja usar?")
        }

        category, question_text = category_map[question_number]

        # Get dynamic choices from specs
        choices = get_specs_for_category(db, category)

        # Build options text for display
        options_text = "\n".join([f"○ {choice['label']}" for choice in choices])

        return {
            "role": "assistant",
            "content": f"{question_text}\n\n{options_text}\n\nPor favor, escolha uma das opções acima.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "single_choice",
            "question_number": question_number,
            "options": {
                "type": "single",
                "choices": choices
            }
        }

    # Q8-Q16: Concept Questions
    elif question_number == 8:
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 8: Qual é a visão do projeto e o problema que ele resolve?\n\nDescreva brevemente:\n- Qual problema ou necessidade este projeto vai resolver?\n- Qual é o objetivo principal?\n- Quem são os usuários/clientes finais?",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 8
        }

    elif question_number == 9:
        return {
            "role": "assistant",
            "content": "📋 Pergunta 9: Quais são os principais módulos/funcionalidades do sistema?\n\nSelecione todos que se aplicam ao seu projeto:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 9,
            "options": {
                "type": "multiple",
                "choices": [
                    {"id": "auth", "label": "🔐 Autenticação e Controle de Acesso", "value": "auth"},
                    {"id": "crud", "label": "📝 CRUD de Entidades/Recursos", "value": "crud"},
                    {"id": "reports", "label": "📊 Relatórios e Dashboards", "value": "reports"},
                    {"id": "workflow", "label": "🔄 Fluxos de Trabalho/Processos", "value": "workflow"},
                    {"id": "notifications", "label": "🔔 Notificações e Alertas", "value": "notifications"},
                    {"id": "integration", "label": "🔌 Integrações Externas (APIs, Webhooks)", "value": "integration"},
                    {"id": "files", "label": "📁 Upload/Gerenciamento de Arquivos", "value": "files"},
                    {"id": "search", "label": "🔍 Busca e Filtros Avançados", "value": "search"},
                    {"id": "payments", "label": "💳 Pagamentos/Transações Financeiras", "value": "payments"},
                    {"id": "messaging", "label": "💬 Mensagens/Chat/Comunicação", "value": "messaging"},
                    {"id": "calendar", "label": "📅 Calendário/Agendamento", "value": "calendar"},
                    {"id": "analytics", "label": "📈 Analytics e Métricas", "value": "analytics"}
                ]
            }
        }

    elif question_number == 10:
        return {
            "role": "assistant",
            "content": "👥 Pergunta 10: Quais são os perfis de usuários e suas permissões?\n\nDescreva os principais tipos de usuários e o que cada um pode fazer no sistema.\n\nExemplo:\n- Admin: Acesso total, gerencia usuários, configurações\n- Editor: Cria e edita conteúdo, não gerencia usuários\n- Visualizador: Apenas visualiza, sem edição",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 10
        }

    elif question_number == 11:
        return {
            "role": "assistant",
            "content": "⚙️ Pergunta 11: Quais são as principais regras de negócio do sistema?\n\nDescreva as regras críticas que o sistema deve seguir.\n\nExemplo:\n- Pedido só pode ser cancelado até 24h após criação\n- Usuário só pode aprovar documentos do seu departamento\n- Saldo não pode ficar negativo",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 11
        }

    elif question_number == 12:
        return {
            "role": "assistant",
            "content": "🗃️ Pergunta 12: Quais são as principais entidades/dados do sistema?\n\nListe as entidades principais e seus relacionamentos básicos.\n\nExemplo:\n- Usuário (tem múltiplos Pedidos)\n- Pedido (pertence a um Usuário, contém múltiplos Itens)\n- Produto (pode estar em múltiplos Pedidos via Itens)\n- Categoria (agrupa Produtos)",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 12
        }

    elif question_number == 13:
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 13: Quais são os critérios de sucesso do projeto?\n\nComo você vai medir se o projeto foi bem-sucedido?\n\nExemplo:\n- Processar 1000 pedidos por dia sem erros\n- Tempo de resposta < 2 segundos em 95% das requisições\n- Taxa de conversão de 15% nos primeiros 6 meses\n- Reduzir tempo de processamento manual de 4h para 30min",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 13
        }

    elif question_number == 14:
        return {
            "role": "assistant",
            "content": "🔧 Pergunta 14: Há alguma restrição técnica ou preferência arquitetural?\n\nDescreva limitações ou decisões técnicas já definidas.\n\nExemplo:\n- Deve rodar em infraestrutura AWS específica\n- Precisa integrar com sistema legado X\n- Segurança: LGPD compliance obrigatório\n- Performance: Suportar 10.000 usuários simultâneos",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 14
        }

    elif question_number == 15:
        return {
            "role": "assistant",
            "content": "📌 Pergunta 15: Qual é o escopo e prioridades do MVP (Minimum Viable Product)?\n\nQuais funcionalidades DEVEM estar na primeira versão (MVP) vs. podem ficar para depois?\n\nExemplo:\n✅ MVP (Essencial):\n- Login e autenticação\n- CRUD de pedidos\n- Relatório básico de vendas\n\n⏳ Versão 2 (Desejável):\n- Dashboard avançado\n- Integrações com marketplaces\n- App mobile",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 15
        }

    elif question_number == 16:
        # PROMPT #77 - Topic Selection for Focused Discussion
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 16: Sobre quais aspectos do projeto você quer conversar mais profundamente?\n\nSelecione os tópicos que você deseja conceitualizar e aprofundar com a IA:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 16,
            "options": {
                "type": "multiple",
                "choices": [
                    {
                        "id": "business_rules",
                        "label": "⚙️ Regras de Negócio",
                        "value": "business_rules",
                        "description": "Aprofundar em regras, validações e lógica de negócio"
                    },
                    {
                        "id": "design_ux",
                        "label": "🎨 Design e UX/UI",
                        "value": "design_ux",
                        "description": "Discutir interfaces, experiência do usuário e design visual"
                    },
                    {
                        "id": "architecture",
                        "label": "🏗️ Conceito e Arquitetura",
                        "value": "architecture",
                        "description": "Definir estrutura técnica, padrões e arquitetura do sistema"
                    },
                    {
                        "id": "security",
                        "label": "🔒 Segurança",
                        "value": "security",
                        "description": "Explorar requisitos de segurança, autenticação e proteção de dados"
                    },
                    {
                        "id": "performance",
                        "label": "⚡ Performance e Escalabilidade",
                        "value": "performance",
                        "description": "Discutir otimização, caching, load balancing e crescimento"
                    },
                    {
                        "id": "integrations",
                        "label": "🔌 Integrações",
                        "value": "integrations",
                        "description": "Definir integrações com sistemas externos, APIs e webhooks"
                    },
                    {
                        "id": "workflows",
                        "label": "🔄 Workflows e Processos",
                        "value": "workflows",
                        "description": "Detalhar fluxos de trabalho, automações e processos de negócio"
                    },
                    {
                        "id": "data_model",
                        "label": "🗃️ Modelagem de Dados",
                        "value": "data_model",
                        "description": "Aprofundar em entidades, relacionamentos e estrutura de dados"
                    },
                    {
                        "id": "deployment",
                        "label": "🚀 Deploy e Infraestrutura",
                        "value": "deployment",
                        "description": "Discutir estratégias de deploy, CI/CD e infraestrutura"
                    },
                    {
                        "id": "testing",
                        "label": "🧪 Testes e Qualidade",
                        "value": "testing",
                        "description": "Definir estratégias de testes, coverage e garantia de qualidade"
                    }
                ]
            }
        }

    # Q17+ are AI-generated contextual questions to clarify details
    return None
