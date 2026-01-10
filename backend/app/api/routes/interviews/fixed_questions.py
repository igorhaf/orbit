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

        # Mobile
        'react-native': 'React Native',
        'flutter': 'Flutter',
        'ios-swift': 'Native iOS (Swift)',
        'android-kotlin': 'Native Android (Kotlin)',
        'ionic': 'Ionic',
        'no-mobile': 'Sem Mobile',
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
    PROMPT #77 - Topic Selection (Q17)
    PROMPT #79 - Stack Questions Added (Q1-Q7)
    PROMPT #81 - Project Modules Question Added (Q8)

    Meta prompt is ALWAYS the first interview for any project.
    It gathers comprehensive information to generate the entire project hierarchy
    (Epics → Stories → Tasks → Subtasks) with atomic prompts.

    Fixed Questions (Q1-Q17):
    - Q1: Project Title
    - Q2: Project Description
    - Q3: Backend Framework
    - Q4: Database
    - Q5: Frontend Framework
    - Q6: CSS Framework
    - Q7: Mobile Framework
    - Q8: Project Modules/Components (Backend/API, Frontend Web, Mobile App, etc.)
    - Q9: Project Vision & Problem Statement
    - Q10: Main Features/Modules (Auth, CRUD, Reports, etc.)
    - Q11: User Roles & Permissions
    - Q12: Key Business Rules & Logic
    - Q13: Data & Entities
    - Q14: Success Criteria & Goals
    - Q15: Technical Constraints/Preferences
    - Q16: Project Scope & Priorities (MVP)
    - Q17: Focus Topics (PROMPT #77)

    After Q17, AI can ask contextual questions to clarify details.

    Args:
        question_number: Question number (Q1-Q17 are fixed for meta prompt)
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
            "content": "📝 Pergunta 2: Descreva brevemente o objetivo do projeto.\n\nForneça uma breve descrição do que o projeto faz e qual problema resolve.",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "text",
            "question_number": 2,
            "prefilled_value": project.description or ""
        }

    # Q3: Tipo de Sistema
    elif question_number == 3:
        return {
            "role": "assistant",
            "content": "🏗️ Pergunta 3: Que tipo de sistema você vai desenvolver?\n\nEscolha o tipo de aplicação que será construída:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "single_choice",
            "question_number": 3,
            "options": {
                "type": "single",
                "choices": [
                    {
                        "id": "apenas_api",
                        "label": "🔌 Apenas API",
                        "value": "apenas_api",
                        "description": "API REST/GraphQL sem interface visual"
                    },
                    {
                        "id": "api_frontend",
                        "label": "💻 API + Frontend Web",
                        "value": "api_frontend",
                        "description": "API + aplicação web (SPA/SSR)"
                    },
                    {
                        "id": "api_mobile",
                        "label": "📱 API + Mobile",
                        "value": "api_mobile",
                        "description": "API + aplicativo móvel (iOS/Android)"
                    },
                    {
                        "id": "api_frontend_mobile",
                        "label": "🌐 API + Frontend + Mobile",
                        "value": "api_frontend_mobile",
                        "description": "Solução completa: API + Web + Mobile"
                    }
                ]
            }
        }

    # Q4-Q8: Stack Questions (Backend, Database, Frontend, CSS, Mobile)
    elif question_number in [4, 5, 6, 7, 8]:
        category_map = {
            4: ("backend", "🔧 Pergunta 4: Qual framework de backend você vai usar?"),
            5: ("database", "🗄️ Pergunta 5: Qual banco de dados você vai usar?"),
            6: ("frontend", "💻 Pergunta 6: Qual framework de frontend você vai usar?"),
            7: ("css", "🎨 Pergunta 7: Qual framework CSS você vai usar?"),
            8: ("mobile", "📱 Pergunta 8: Qual framework mobile você deseja usar?")
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

    # Q9: Additional Project Modules/Components (PROMPT #97 - No redundancy with Q3)
    # Q3 already covers: API, Frontend Web, Mobile
    # Q9 focuses on ADDITIONAL features/modules not mentioned in Q3
    elif question_number == 9:
        return {
            "role": "assistant",
            "content": "🏗️ Pergunta 9: Além dos componentes principais, quais funcionalidades/módulos adicionais você precisa?\n\nSelecione todos que se aplicam (OPCIONAL - pode deixar em branco se não precisar de nenhum):",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 9,
            "options": {
                "type": "multiple",
                "choices": [
                    # REMOVED redundant options (backend_api, frontend_web, mobile_app)
                    # They are already covered by Q3 (System Type)
                    # Q9 now focuses ONLY on additional features
                    {
                        "id": "admin_dashboard",
                        "label": "⚙️ Dashboard Administrativo",
                        "value": "admin_dashboard",
                        "description": "Painel de administração para gestão do sistema"
                    },
                    {
                        "id": "landing_page",
                        "label": "🌐 Landing Page/Site Institucional",
                        "value": "landing_page",
                        "description": "Site público para divulgação/captação"
                    },
                    {
                        "id": "background_jobs",
                        "label": "⚡ Workers/Jobs em Background",
                        "value": "background_jobs",
                        "description": "Processamento assíncrono, filas, cron jobs"
                    },
                    {
                        "id": "notification_system",
                        "label": "🔔 Sistema de Notificações",
                        "value": "notification_system",
                        "description": "Envio de notificações (email, SMS, push)"
                    },
                    {
                        "id": "reporting_system",
                        "label": "📊 Sistema de Relatórios/BI",
                        "value": "reporting_system",
                        "description": "Geração de relatórios e dashboards analíticos"
                    }
                ]
            }
        }

    # Q10-Q18: Concept Questions (renumbered from Q9-Q17)
    elif question_number == 10:
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 10: Qual é o principal problema ou necessidade que este projeto resolve?\n\nSelecione o tipo de problema/necessidade principal:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "single_choice",
            "question_number": 10,
            "options": {
                "type": "single",
                "choices": [
                    {"id": "automation", "label": "⚙️ Automatizar processos manuais", "value": "automation"},
                    {"id": "efficiency", "label": "🚀 Aumentar eficiência e produtividade", "value": "efficiency"},
                    {"id": "sales", "label": "💰 Aumentar vendas e receita", "value": "sales"},
                    {"id": "experience", "label": "😊 Melhorar experiência do usuário/cliente", "value": "experience"},
                    {"id": "data", "label": "📊 Organizar e analisar dados", "value": "data"},
                    {"id": "communication", "label": "💬 Facilitar comunicação e colaboração", "value": "communication"},
                    {"id": "access", "label": "🌐 Disponibilizar serviços/produtos online", "value": "access"},
                    {"id": "control", "label": "🔐 Controlar acessos e permissões", "value": "control"},
                    {"id": "integration", "label": "🔌 Integrar sistemas diferentes", "value": "integration"},
                    {"id": "cost", "label": "💵 Reduzir custos operacionais", "value": "cost"}
                ]
            }
        }

    elif question_number == 11:
        return {
            "role": "assistant",
            "content": "📋 Pergunta 11: Quais são os principais módulos/funcionalidades do sistema?\n\nSelecione todos que se aplicam ao seu projeto:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 11,
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

    elif question_number == 12:
        return {
            "role": "assistant",
            "content": "👥 Pergunta 12: Quais perfis de usuários o sistema terá?\n\nSelecione todos os perfis de usuário necessários:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 12,
            "options": {
                "type": "multiple",
                "choices": [
                    {"id": "admin", "label": "👑 Administrador (acesso total ao sistema)", "value": "admin"},
                    {"id": "manager", "label": "📊 Gerente (supervisiona operações e equipes)", "value": "manager"},
                    {"id": "editor", "label": "✏️ Editor (cria e edita conteúdo)", "value": "editor"},
                    {"id": "operator", "label": "⚙️ Operador (executa operações do dia-a-dia)", "value": "operator"},
                    {"id": "viewer", "label": "👁️ Visualizador (apenas consulta, sem edição)", "value": "viewer"},
                    {"id": "customer", "label": "🛒 Cliente/Usuário final (usa o sistema)", "value": "customer"},
                    {"id": "moderator", "label": "🛡️ Moderador (revisa e aprova conteúdo)", "value": "moderator"},
                    {"id": "analyst", "label": "📈 Analista (acessa relatórios e dados)", "value": "analyst"},
                    {"id": "support", "label": "💬 Suporte (atende usuários)", "value": "support"}
                ]
            }
        }

    elif question_number == 13:
        return {
            "role": "assistant",
            "content": "⚙️ Pergunta 13: Quais tipos de regras de negócio são críticas para o sistema?\n\nSelecione todas as categorias de regras necessárias:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 13,
            "options": {
                "type": "multiple",
                "choices": [
                    {"id": "validation", "label": "✅ Validações de dados (formato, obrigatoriedade, limites)", "value": "validation"},
                    {"id": "workflow", "label": "🔄 Regras de workflow (status, transições, aprovações)", "value": "workflow"},
                    {"id": "access", "label": "🔐 Regras de acesso (quem pode fazer o quê)", "value": "access"},
                    {"id": "calculation", "label": "🧮 Cálculos e fórmulas de negócio", "value": "calculation"},
                    {"id": "timing", "label": "⏰ Regras temporais (prazos, janelas, expiração)", "value": "timing"},
                    {"id": "financial", "label": "💰 Regras financeiras (preços, descontos, limites)", "value": "financial"},
                    {"id": "hierarchy", "label": "🏗️ Hierarquias e dependências (relacionamentos)", "value": "hierarchy"},
                    {"id": "notifications", "label": "🔔 Gatilhos de notificação (quando alertar)", "value": "notifications"},
                    {"id": "integration", "label": "🔌 Regras de integração externa", "value": "integration"}
                ]
            }
        }

    elif question_number == 14:
        return {
            "role": "assistant",
            "content": "🗃️ Pergunta 14: Quais são os principais tipos de dados/entidades que o sistema gerencia?\n\nSelecione todas as categorias de dados relevantes:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 14,
            "options": {
                "type": "multiple",
                "choices": [
                    {"id": "users", "label": "👥 Usuários e Perfis", "value": "users"},
                    {"id": "products", "label": "📦 Produtos/Serviços/Itens", "value": "products"},
                    {"id": "orders", "label": "🛒 Pedidos/Transações/Vendas", "value": "orders"},
                    {"id": "customers", "label": "🧑‍💼 Clientes/Fornecedores", "value": "customers"},
                    {"id": "documents", "label": "📄 Documentos/Arquivos", "value": "documents"},
                    {"id": "events", "label": "📅 Eventos/Agendamentos", "value": "events"},
                    {"id": "messages", "label": "💬 Mensagens/Comunicações", "value": "messages"},
                    {"id": "financial", "label": "💰 Dados Financeiros (pagamentos, faturas)", "value": "financial"},
                    {"id": "inventory", "label": "📊 Estoque/Recursos", "value": "inventory"},
                    {"id": "analytics", "label": "📈 Métricas/Logs/Analytics", "value": "analytics"},
                    {"id": "content", "label": "📝 Conteúdo (posts, artigos, mídias)", "value": "content"},
                    {"id": "settings", "label": "⚙️ Configurações/Parâmetros", "value": "settings"}
                ]
            }
        }

    elif question_number == 15:
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 15: Quais métricas são mais importantes para medir o sucesso do projeto?\n\nSelecione todas as métricas de sucesso relevantes:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 15,
            "options": {
                "type": "multiple",
                "choices": [
                    {"id": "performance", "label": "⚡ Performance (tempo de resposta, velocidade)", "value": "performance"},
                    {"id": "volume", "label": "📊 Volume de transações/operações", "value": "volume"},
                    {"id": "adoption", "label": "👥 Taxa de adoção/usuários ativos", "value": "adoption"},
                    {"id": "conversion", "label": "💰 Taxa de conversão/vendas", "value": "conversion"},
                    {"id": "efficiency", "label": "🚀 Redução de tempo/esforço manual", "value": "efficiency"},
                    {"id": "quality", "label": "✅ Qualidade (taxa de erros, bugs)", "value": "quality"},
                    {"id": "satisfaction", "label": "😊 Satisfação do usuário (NPS, feedback)", "value": "satisfaction"},
                    {"id": "availability", "label": "🔄 Disponibilidade/Uptime", "value": "availability"},
                    {"id": "cost", "label": "💵 Redução de custos operacionais", "value": "cost"},
                    {"id": "roi", "label": "📈 ROI (retorno sobre investimento)", "value": "roi"}
                ]
            }
        }

    elif question_number == 16:
        return {
            "role": "assistant",
            "content": "🔧 Pergunta 16: Quais restrições técnicas ou requisitos especiais o projeto possui?\n\nSelecione todas as restrições/requisitos aplicáveis:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 16,
            "options": {
                "type": "multiple",
                "choices": [
                    {"id": "infrastructure", "label": "☁️ Infraestrutura específica (AWS, Azure, GCP, on-premise)", "value": "infrastructure"},
                    {"id": "compliance", "label": "🔒 Compliance e regulamentação (LGPD, GDPR, HIPAA)", "value": "compliance"},
                    {"id": "legacy", "label": "🔄 Integração com sistemas legados", "value": "legacy"},
                    {"id": "scalability", "label": "📈 Alta escalabilidade (muitos usuários simultâneos)", "value": "scalability"},
                    {"id": "availability", "label": "⏰ Alta disponibilidade (99.9% uptime)", "value": "availability"},
                    {"id": "security", "label": "🛡️ Requisitos avançados de segurança", "value": "security"},
                    {"id": "offline", "label": "📱 Funcionamento offline/modo avião", "value": "offline"},
                    {"id": "mobile", "label": "📲 Suporte mobile nativo (iOS/Android)", "value": "mobile"},
                    {"id": "api", "label": "🔌 API pública para terceiros", "value": "api"},
                    {"id": "none", "label": "✅ Nenhuma restrição técnica específica", "value": "none"}
                ]
            }
        }

    elif question_number == 17:
        return {
            "role": "assistant",
            "content": "📌 Pergunta 17: Qual é a estratégia de lançamento do projeto?\n\nSelecione a abordagem que melhor descreve o planejamento:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "single_choice",
            "question_number": 17,
            "options": {
                "type": "single",
                "choices": [
                    {"id": "mvp_lean", "label": "🚀 MVP Mínimo (funcionalidades essenciais apenas, lançar rápido)", "value": "mvp_lean"},
                    {"id": "mvp_robust", "label": "⭐ MVP Robusto (funcionalidades core bem completas)", "value": "mvp_robust"},
                    {"id": "phased", "label": "📊 Lançamento em fases (incrementar features gradualmente)", "value": "phased"},
                    {"id": "full", "label": "🎯 Lançamento completo (tudo de uma vez)", "value": "full"},
                    {"id": "beta", "label": "🧪 Beta/Pilot (grupo restrito primeiro, depois escalona)", "value": "beta"},
                    {"id": "undefined", "label": "❓ Ainda não definido", "value": "undefined"}
                ]
            }
        }

    elif question_number == 18:
        # PROMPT #77 - Topic Selection for Focused Discussion
        return {
            "role": "assistant",
            "content": "🎯 Pergunta 18: Sobre quais aspectos do projeto você quer conversar mais profundamente?\n\nSelecione os tópicos que você deseja conceitualizar e aprofundar com a IA:",
            "timestamp": datetime.utcnow().isoformat(),
            "model": "system/fixed-question-meta-prompt",
            "question_type": "multiple_choice",
            "question_number": 18,
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

    # Q19+ are AI-generated contextual questions to clarify details
    return None
