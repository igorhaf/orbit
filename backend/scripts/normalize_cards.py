"""
ORBIT Card Normalizer - PROMPT #245

Normalizes all from_rag cards to match ORBIT's proper card format:
- Epic: business-focused title, structured description with Contexto/Regras/Nivel sections
- Story: "Como [user], eu quero [action]" title, business rule contextual description
- Task: functional+technical title (max 80 chars), balanced description
- Subtask: action-specific title (max 100 chars), technical description

Can be run standalone or imported and called after card creation.
"""
import json
import logging
import os
import sys
import textwrap

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, ".env"), override=True)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("card_normalizer")

PROJECT_ID = "c5afeaed-0b4d-4ad1-835d-a4aa68a989fb"


# ============================================================================
# TITLE NORMALIZATION
# ============================================================================

def normalize_epic_title(title: str, domain: str) -> str:
    """Epic titles: business-focused, Portuguese, concise."""
    # Map domain names to proper Portuguese epic titles
    TITLE_MAP = {
        "AI Orchestration": "Orquestracao de IA e Multi-Provider",
        "RAG Pipeline": "Pipeline RAG e Base de Conhecimento",
        "Project Lifecycle": "Ciclo de Vida do Projeto",
        "Card Hierarchy": "Sistema Hierarquico de Cards",
        "Card Activation": "Ativacao e Aprovacao de Cards",
        "Interview System": "Sistema de Entrevistas com IA",
        "Data Protection": "Protecao de Dados e Seguranca",
        "Job Queue": "Fila de Jobs e Notificacoes",
        "Wiki & Knowledge": "Wiki e Gestao de Conhecimento",
        "Frontend Architecture": "Arquitetura Frontend e UI",
        "Cost & Analytics": "Custos e Analiticas de IA",
        "Data Model": "Modelo de Dados e Integridade",
        "Rate Limiting & Provider Backoff": "Rate Limiting e Backoff de Providers",
        "Error Classification & Retry": "Classificacao de Erros e Retry",
        "Workflow State Machine": "Maquina de Estados de Workflow",
        "Pipeline Validation & Anti-Hallucination": "Validacao de Pipeline e Anti-Alucinacao",
        "Similarity Detection & Deduplication": "Deteccao de Similaridade e Deduplicacao",
        "Modification Approval Workflow": "Fluxo de Aprovacao de Modificacoes",
        "Token Budget Management": "Gestao de Orcamento de Tokens",
        "Prompt Structure & Compression": "Estrutura e Compressao de Prompts",
        "AI Response Validation": "Validacao de Respostas de IA",
        "Utility Node Pipeline": "Pipeline de Nos Utilitarios",
        "Query Classification": "Classificacao de Queries",
        "File Upload & Archive Security": "Upload de Arquivos e Seguranca",
        "Codebase Scanning & Indexing": "Scan e Indexacao de Codebase",
        "Knowledge Graph & Static Analysis": "Grafo de Conhecimento e Analise Estatica",
        "Staged Pattern Discovery": "Descoberta de Padroes em Estagios",
        "Backlog Generation & Decomposition": "Geracao e Decomposicao de Backlog",
        "Task Hierarchy Rules": "Regras de Hierarquia de Tasks",
        "Card Activation & Lifecycle": "Ciclo de Vida e Ativacao de Cards",
        "Business Rule Card Generation": "Geracao de Cards de Regras de Negocio",
        "Project Protection & Configuration": "Protecao e Configuracao de Projetos",
        "Symbol Extraction & Code Analysis": "Extracao de Simbolos e Analise de Codigo",
        "Watchdog Operational Rules": "Regras Operacionais do Watchdog",
        "Pipeline Card Generation": "Geracao Incremental de Cards",
        "Pipeline Wiki Generation": "Geracao Incremental de Wiki",
        "Batch Execution & Dependencies": "Execucao em Lote e Dependencias",
        "Interview Model Rules": "Regras do Modelo de Entrevistas",
        "Pricing & Cost Calculation": "Precificacao e Calculo de Custos",
        "Configuration & System Limits": "Configuracao e Limites do Sistema",
    }
    return TITLE_MAP.get(domain, TITLE_MAP.get(title, title))


def normalize_story_title(title: str, rules: list, parent_epic_title: str) -> str:
    """Story titles: 'Como [user], eu quero [action]' format."""
    # Extract a meaningful action from the story name or rules
    action = title.replace("_", " ").strip()

    # Map common story names to user story format
    STORY_MAP = {
        "Ai Orchestrator": "Como operador do sistema, eu quero orquestrar modelos de IA com fallback automatico",
        "Ai Model": "Como administrador, eu quero configurar modelos de IA via interface web",
        "Ai Flow": "Como administrador, eu quero gerenciar chains de fallback de modelos",
        "Continuous Rag Service": "Como sistema, eu quero escanear arquivos continuamente e detectar mudancas",
        "Rag Service": "Como usuario, eu quero buscar conhecimento via busca semantica",
        "Knowledge": "Como usuario, eu quero fazer upload e buscar documentos na base de conhecimento",
        "Codebase Memory": "Como sistema, eu quero analisar e memorizar a estrutura do codebase",
        "Projects": "Como usuario, eu quero gerenciar projetos com validacao de code_path",
        "Project": "Como sistema, eu quero controlar o ciclo de vida e contexto do projeto",
        "Business Rules": "Como sistema, eu quero gerar cards hierarquicos a partir de regras de negocio",
        "Card Activator": "Como usuario, eu quero ativar cards com protecao REGRA #0",
        "Draft Generator": "Como sistema, eu quero gerar drafts de cards filhos automaticamente",
        "Endpoints": "Como usuario, eu quero conduzir entrevistas de contexto e epicos",
        "Fixed Questions": "Como sistema, eu quero coletar informacoes com perguntas fixas Q1-Q8",
        "Interview": "Como usuario, eu quero conduzir entrevistas com modos diferentes",
        "Task": "Como sistema, eu quero proteger dados humanos contra sobrescrita por IA",
        "Orbit Folder": "Como sistema, eu quero proteger a pasta satellite de delecao",
        "Wiki Fs": "Como sistema, eu quero gerenciar paginas wiki com protecao REGRA #0",
        "Async Job": "Como sistema, eu quero gerenciar prioridades e hierarquia de jobs",
        "Layout": "Como usuario, eu quero navegar com layout e breadcrumbs padronizados",
        "Page": "Como usuario, eu quero ver dashboard com atualizacao automatica",
        "Cost Analytics": "Como usuario, eu quero monitorar custos e metricas de IA",
        "Ai Execution": "Como sistema, eu quero registrar todas as execucoes de IA",
        "Prompts": "Como usuario, eu quero gerenciar versoes de prompts",
        "Status Transition": "Como sistema, eu quero auditar todas as transicoes de status",
        "Prompt Queue": "Como sistema, eu quero ordenar prompts por hierarquia e prioridade",
        "Rag File State": "Como sistema, eu quero rastrear estado de cada arquivo por projeto",
        "Tasks Routes": "Como sistema, eu quero detectar bloqueio por similaridade semantica",
        "Commit": "Como sistema, eu quero seguir convencao de commits padronizada",
        "Task Relationship": "Como usuario, eu quero criar relacoes entre tasks sem duplicatas",
    }

    mapped = STORY_MAP.get(title)
    if mapped:
        return mapped

    # Generic fallback: derive from parent epic context
    action_clean = action.lower().replace(".", "").strip()
    if len(action_clean) < 5:
        action_clean = parent_epic_title.lower()

    return f"Como usuario do ORBIT, eu quero {action_clean}"


def normalize_task_title(title: str, rules: list) -> str:
    """Task titles: functional+technical, max 80 chars, Portuguese."""
    # If it's already a rule-based title like "X - Rules 1-3", make it functional
    if " - Rules " in title:
        # Use first rule to create meaningful title
        if rules:
            first_rule = rules[0] if isinstance(rules, list) else str(rules)
            # Extract key action from rule
            title = _extract_action_from_rule(first_rule)
        else:
            title = title.split(" - Rules")[0]

    # If title is a raw rule text, shorten it
    if len(title) > 80:
        title = title[:77] + "..."

    return title


def normalize_subtask_title(title: str) -> str:
    """Subtask titles: action-specific, max 100 chars, Portuguese."""
    if len(title) > 100:
        title = title[:97] + "..."
    return title


def _extract_action_from_rule(rule_text: str) -> str:
    """Extract a concise action from a rule text."""
    # Take the first meaningful clause
    text = rule_text.strip()
    # Remove common prefixes
    for prefix in ["REGRA #0:", "REGRA #0 -"]:
        if text.startswith(prefix):
            text = text[len(prefix):].strip()

    # Truncate at first semicolon or colon-space
    for sep in ["; ", ": ", " - ", " -- "]:
        if sep in text:
            text = text[:text.index(sep)]
            break

    if len(text) > 80:
        text = text[:77] + "..."
    return text


# ============================================================================
# DESCRIPTION NORMALIZATION
# ============================================================================

def normalize_epic_description(title: str, domain: str, stories: list, rules: list) -> str:
    """Epic description: structured with Contexto, Regras, Nivel sections."""
    rules_text = "\n".join(f"- {r}" for r in rules[:15])
    stories_text = "\n".join(f"- {s}" for s in stories)

    return f"""# {title}

## Contexto

Este epico abrange o dominio **{domain}** do sistema ORBIT, cobrindo {len(stories)} stories e {len(rules)} regras de negocio. Define as funcionalidades e restricoes fundamentais para o correto funcionamento deste modulo.

## Regras de Negocio Aplicaveis

{rules_text}

## Stories

{stories_text}

## Nivel

Epic"""


def normalize_story_description(title: str, parent_epic: str, rules: list) -> str:
    """Story description: business rule contextual."""
    rules_text = "\n".join(f"{i}. {r}" for i, r in enumerate(rules, 1))

    return f"""# {title}

## Contexto

Story do epico **{parent_epic}**. Descreve como as regras de negocio se aplicam ao usuario final e quais restricoes o sistema deve respeitar.

## Regras de Negocio

{rules_text}

## Criterios de Aceitacao

Todas as {len(rules)} regras de negocio acima devem estar implementadas e validadas com testes.

## Nivel

Story"""


def normalize_task_description(title: str, parent_story: str, rules: list) -> str:
    """Task description: balanced functional + technical."""
    rules_text = "\n".join(f"- {r}" for r in rules)

    return f"""# {title}

## Contexto

Subtarefa da story **{parent_story}**. Define o que precisa ser construido e indica os componentes e modulos envolvidos.

## Requisitos Tecnicos

{rules_text}

## Nivel

Task"""


def normalize_subtask_description(title: str, parent_task: str, rule_text: str) -> str:
    """Subtask description: objectively technical."""
    return f"""# {title}

## Contexto

Implementacao atomica da task **{parent_task}**.

## Especificacao

{rule_text}

## Instrucoes

Implementar a regra acima garantindo que:
1. A funcionalidade esteja coberta por testes
2. A documentacao esteja atualizada
3. O codigo siga os padroes existentes do projeto

## Nivel

Subtask"""


# ============================================================================
# GENERATED PROMPT NORMALIZATION
# ============================================================================

def normalize_epic_prompt(title: str, domain: str, semantic_map: dict, rules: list) -> str:
    """Epic prompt: semantic markdown with identifiers."""
    map_text = "\n".join(f"- **{k}**: {v}" for k, v in semantic_map.items())
    rules_text = "\n".join(f"{i}. {r}" for i, r in enumerate(rules, 1))

    return f"""# EPIC: {title}

## Mapa Semantico

{map_text}

## Regras de Negocio

{rules_text}

## Instrucoes

Implementar {title} respeitando todas as regras de negocio listadas acima.
Cada criterio de aceitacao deve ser verificavel e testavel."""


def normalize_story_prompt(title: str, parent_epic: str, semantic_map: dict, rules: list) -> str:
    """Story prompt: semantic with inherited identifiers."""
    map_text = "\n".join(f"- **{k}**: {v}" for k, v in semantic_map.items())
    rules_text = "\n".join(f"{i}. {r}" for i, r in enumerate(rules, 1))

    return f"""# STORY: {title}

## Mapa Semantico

{map_text}

## Requisitos do Epic

Epic pai: {parent_epic}

## Regras de Negocio

{rules_text}

## Instrucoes

Implementar esta story garantindo que todas as regras de negocio estejam respeitadas.
Descrever COMO as regras se aplicam ao usuario final."""


def normalize_task_prompt(title: str, parent_story: str, semantic_map: dict, rules: list) -> str:
    """Task prompt: technical with file/method identifiers."""
    map_text = "\n".join(f"- **{k}**: {v}" for k, v in semantic_map.items())
    rules_text = "\n".join(f"- {r}" for r in rules)

    return f"""# TASK: {title}

## Mapa Semantico

{map_text}

## Story Pai

{parent_story}

## Requisitos Tecnicos

{rules_text}

## Instrucoes

Implementar esta task com equilibrio entre funcional e tecnico.
Indicar componentes, endpoints e modulos envolvidos."""


def normalize_subtask_prompt(title: str, parent_task: str, rule_text: str) -> str:
    """Subtask prompt: code-level detail."""
    return f"""# SUBTASK: {title}

## Task Pai

{parent_task}

## Especificacao Tecnica

{rule_text}

## Instrucoes

Implementacao atomica. Usar nomes reais de arquivos, funcoes e classes.
Conteudo deve ser diretamente acionavel por um desenvolvedor."""


# ============================================================================
# ACCEPTANCE CRITERIA NORMALIZATION
# ============================================================================

def normalize_acceptance_criteria(criteria: list, item_type: str, rules: list = None) -> list:
    """Normalize AC to 'ACn: [criterion]' format."""
    new_ac = []

    if rules:
        for i, r in enumerate(rules[:6], 1):
            text = r[:200] if len(r) > 200 else r
            new_ac.append(f"AC{i}: {text}")
    elif criteria:
        for i, c in enumerate(criteria, 1):
            # Strip old prefixes
            text = c
            for prefix in ["Implement: ", "Validate: ", "Implement all ", "All "]:
                if text.startswith(prefix):
                    text = text[len(prefix):]
            text = text[:200]
            new_ac.append(f"AC{i}: {text}")

    if not new_ac:
        FALLBACKS = {
            "epic": ["AC1: Modulo implementado e funcional", "AC2: Testes unitarios cobrindo os fluxos principais", "AC3: Documentacao tecnica atualizada"],
            "story": ["AC1: Story funcional e testada", "AC2: Criterios de aceitacao verificados", "AC3: Testes de integracao passando"],
            "task": ["AC1: Task implementada conforme especificacao", "AC2: Testes unitarios adicionados"],
            "subtask": ["AC1: Subtask concluida conforme especificacao"],
        }
        new_ac = FALLBACKS.get(item_type, ["AC1: Funcionalidade implementada"])

    return new_ac


# ============================================================================
# SEMANTIC MAP BUILDER
# ============================================================================

def build_semantic_map(item_type: str, title: str, domain: str, rules: list, story_names: list = None, parent_map: dict = None) -> dict:
    """Build proper semantic map with identifiers."""
    sem = {}

    if parent_map:
        sem.update(parent_map)

    if item_type == "epic":
        sem["N1"] = title
        sem["P1"] = f"Dominio: {domain}"
        for i, r in enumerate(rules[:10], 1):
            sem[f"RN{i}"] = r[:100]
        if story_names:
            for i, s in enumerate(story_names[:5], 1):
                sem[f"S{i}"] = s

    elif item_type == "story":
        sem["N1"] = title
        for i, r in enumerate(rules[:8], 1):
            sem[f"RN{i}"] = r[:100]

    elif item_type == "task":
        sem["N1"] = title
        for i, r in enumerate(rules[:6], 1):
            sem[f"RN{i}"] = r[:80]

    elif item_type == "subtask":
        sem["N1"] = title
        if rules:
            sem["RN1"] = rules[0][:100] if rules[0] else ""

    return sem


# ============================================================================
# SINGLE CARD NORMALIZER (per-card, called immediately after creation)
# ============================================================================

def normalize_single_card(
    db,
    card_id: str,
    item_type: str,
    title: str,
    description: str = "",
    domain: str = "",
    parent_title: str = "",
    children_titles: list = None,
    rules: list = None,
    interview_insights: dict = None,
):
    """
    Normalize a single card immediately after creation.

    Call this right after db.add(card) + db.flush() to ensure each card
    is properly formatted from the moment it's created.

    Args:
        db: SQLAlchemy session
        card_id: UUID of the card
        item_type: "epic", "story", "task", or "subtask"
        title: Current card title
        description: Current card description (used for rule extraction)
        domain: Business domain name (for epics mainly)
        parent_title: Title of the parent card
        children_titles: List of children card titles (for epics: story names)
        rules: List of business rule texts
        interview_insights: Existing insights dict to merge with
    """
    from sqlalchemy import text

    if children_titles is None:
        children_titles = []
    if rules is None:
        rules = _extract_rules_from_description(description) if description else []
    if interview_insights is None:
        interview_insights = {}

    try:
        if item_type == "epic":
            new_title = normalize_epic_title(title, domain)
            semantic_map = build_semantic_map("epic", new_title, domain, rules, children_titles)
            new_desc = normalize_epic_description(new_title, domain, children_titles, rules)
            new_prompt = normalize_epic_prompt(new_title, domain, semantic_map, rules)
            new_ac = normalize_acceptance_criteria(None, "epic", rules)
            new_sp = 13
            new_priority = "high"

        elif item_type == "story":
            new_title = normalize_story_title(title, rules, parent_title)
            parent_map = interview_insights.get("semantic_map", {})
            semantic_map = build_semantic_map("story", new_title, domain, rules, parent_map=parent_map)
            new_desc = normalize_story_description(new_title, parent_title, rules)
            new_prompt = normalize_story_prompt(new_title, parent_title, semantic_map, rules)
            new_ac = normalize_acceptance_criteria(None, "story", rules)
            new_sp = 5
            new_priority = "high"

        elif item_type == "task":
            new_title = normalize_task_title(title, rules)
            parent_map = interview_insights.get("semantic_map", {})
            semantic_map = build_semantic_map("task", new_title, domain, rules, parent_map=parent_map)
            new_desc = normalize_task_description(new_title, parent_title, rules)
            new_prompt = normalize_task_prompt(new_title, parent_title, semantic_map, rules)
            new_ac = normalize_acceptance_criteria(None, "task", rules)
            new_sp = 3
            new_priority = "medium"

        elif item_type == "subtask":
            rule_text = description or title
            new_title = normalize_subtask_title(title)
            semantic_map = build_semantic_map("subtask", new_title, domain, [rule_text])
            new_desc = normalize_subtask_description(new_title, parent_title, rule_text)
            new_prompt = normalize_subtask_prompt(new_title, parent_title, rule_text)
            new_ac = normalize_acceptance_criteria(None, "subtask", [rule_text])
            new_sp = 1
            new_priority = "medium"
        else:
            logger.debug(f"normalize_single_card: unknown item_type '{item_type}', skipping")
            return

        # Merge insights
        new_insights = interview_insights.copy()
        new_insights["semantic_map"] = semantic_map
        new_insights["source"] = "rag_business_rules"
        if domain:
            new_insights["source_domain"] = domain

        db.execute(text("""
            UPDATE tasks SET
                title = :title,
                description = :desc,
                generated_prompt = :prompt,
                acceptance_criteria = :ac,
                story_points = :sp,
                priority = :priority,
                interview_insights = :insights
            WHERE id = :id
        """), {
            "id": card_id,
            "title": new_title,
            "desc": new_desc,
            "prompt": new_prompt,
            "ac": json.dumps(new_ac),
            "sp": new_sp,
            "priority": new_priority,
            "insights": json.dumps(new_insights),
        })

        logger.info(f"Normalized {item_type} card '{new_title[:50]}' ({card_id})")

    except Exception as e:
        logger.warning(f"normalize_single_card failed for {card_id}: {e}")


# ============================================================================
# BATCH NORMALIZER (project-wide, kept for backwards compatibility)
# ============================================================================

def normalize_project_cards(project_id: str, db=None):
    """Normalize all from_rag cards for a project."""
    from sqlalchemy import text
    close_db = False

    if db is None:
        from app.database import SessionLocal
        db = SessionLocal()
        close_db = True

    try:
        logger.info("=" * 60)
        logger.info("CARD NORMALIZATION START")
        logger.info("=" * 60)

        # Load all cards with hierarchy
        cards = db.execute(text("""
            SELECT id, parent_id, item_type, title, description, generated_prompt,
                   acceptance_criteria, story_points, priority, labels,
                   interview_insights, workflow_state
            FROM tasks
            WHERE project_id = :pid AND labels::text LIKE '%from_rag%'
            ORDER BY item_type, title
        """), {"pid": project_id}).fetchall()

        logger.info(f"Found {len(cards)} from_rag cards to normalize")

        # Build maps for hierarchy traversal
        cards_by_id = {}
        children_by_parent = {}
        for c in cards:
            card = dict(c._mapping)
            cards_by_id[card["id"]] = card
            parent = card["parent_id"]
            if parent:
                if parent not in children_by_parent:
                    children_by_parent[parent] = []
                children_by_parent[parent].append(card)

        # Also load RAG rules per domain for context
        rag_rules = db.execute(text("""
            SELECT content, metadata->>'domain' as domain
            FROM rag_documents
            WHERE project_id = :pid AND metadata->>'type' = 'business_rule'
            ORDER BY metadata->>'domain', content
        """), {"pid": project_id}).fetchall()

        rules_by_domain = {}
        for r in rag_rules:
            domain = r.domain
            if domain not in rules_by_domain:
                rules_by_domain[domain] = []
            rules_by_domain[domain].append(r.content)

        # Process epics first, then stories, tasks, subtasks
        counts = {"epic": 0, "story": 0, "task": 0, "subtask": 0}

        for card in cards:
            card = dict(card._mapping)
            cid = card["id"]
            item_type = card["item_type"]
            old_title = card["title"]
            insights = card["interview_insights"] or {}
            if isinstance(insights, str):
                insights = json.loads(insights)

            # Get domain from insights or derive from parent
            domain = insights.get("source_domain", "")
            if not domain and item_type == "epic":
                # Domain is in the old title for epics
                domain = old_title

            # Get rules for this card's domain
            domain_rules = rules_by_domain.get(domain, [])

            # Get children info
            children = children_by_parent.get(cid, [])
            child_names = [ch["title"] for ch in children]

            # Get parent info
            parent_id = card["parent_id"]
            parent_card = cards_by_id.get(parent_id, {}) if parent_id else {}
            parent_title = parent_card.get("title", "")

            # Extract rules from description (they're embedded in numbered lists)
            card_rules = _extract_rules_from_description(card["description"] or "")
            if not card_rules:
                card_rules = domain_rules

            # Normalize by type
            if item_type == "epic":
                new_title = normalize_epic_title(old_title, domain)
                story_names = [ch["title"] for ch in children if ch["item_type"] == "story"]
                semantic_map = build_semantic_map("epic", new_title, domain, card_rules, story_names)
                new_desc = normalize_epic_description(new_title, domain, story_names, card_rules)
                new_prompt = normalize_epic_prompt(new_title, domain, semantic_map, card_rules)
                new_ac = normalize_acceptance_criteria(None, "epic", card_rules)
                new_sp = 13
                new_priority = "high"

            elif item_type == "story":
                new_title = normalize_story_title(old_title, card_rules, parent_title)
                parent_insights = parent_card.get("interview_insights") or {}
                if isinstance(parent_insights, str):
                    parent_insights = json.loads(parent_insights)
                parent_map = parent_insights.get("semantic_map", {})
                semantic_map = build_semantic_map("story", new_title, domain, card_rules, parent_map=parent_map)
                new_desc = normalize_story_description(new_title, parent_title, card_rules)
                new_prompt = normalize_story_prompt(new_title, parent_title, semantic_map, card_rules)
                new_ac = normalize_acceptance_criteria(None, "story", card_rules)
                new_sp = 5
                new_priority = "high"

            elif item_type == "task":
                new_title = normalize_task_title(old_title, card_rules)
                parent_insights = parent_card.get("interview_insights") or {}
                if isinstance(parent_insights, str):
                    parent_insights = json.loads(parent_insights)
                parent_map = parent_insights.get("semantic_map", {})
                semantic_map = build_semantic_map("task", new_title, domain, card_rules, parent_map=parent_map)
                new_desc = normalize_task_description(new_title, parent_title, card_rules)
                new_prompt = normalize_task_prompt(new_title, parent_title, semantic_map, card_rules)
                new_ac = normalize_acceptance_criteria(None, "task", card_rules)
                new_sp = 3
                new_priority = "medium"

            elif item_type == "subtask":
                rule_text = card["description"] or old_title
                new_title = normalize_subtask_title(old_title)
                semantic_map = build_semantic_map("subtask", new_title, domain, [rule_text])
                new_desc = normalize_subtask_description(new_title, parent_title, rule_text)
                new_prompt = normalize_subtask_prompt(new_title, parent_title, rule_text)
                new_ac = normalize_acceptance_criteria(None, "subtask", [rule_text])
                new_sp = 1
                new_priority = "medium"
            else:
                continue

            # Update insights with proper semantic_map
            new_insights = insights.copy()
            new_insights["semantic_map"] = semantic_map
            new_insights["source"] = "rag_business_rules"
            if domain:
                new_insights["source_domain"] = domain

            # Update card
            db.execute(text("""
                UPDATE tasks SET
                    title = :title,
                    description = :desc,
                    generated_prompt = :prompt,
                    acceptance_criteria = :ac,
                    story_points = :sp,
                    priority = :priority,
                    interview_insights = :insights
                WHERE id = :id AND description_edited_by != 'human' AND prompt_edited_by != 'human'
            """), {
                "id": cid,
                "title": new_title,
                "desc": new_desc,
                "prompt": new_prompt,
                "ac": json.dumps(new_ac),
                "sp": new_sp,
                "priority": new_priority,
                "insights": json.dumps(new_insights),
            })
            counts[item_type] += 1

        db.commit()

        logger.info("=" * 60)
        logger.info("NORMALIZATION COMPLETE!")
        logger.info("=" * 60)
        for item_type, count in sorted(counts.items()):
            logger.info(f"  {item_type}: {count} cards normalized")

        return counts

    except Exception as e:
        logger.error(f"Normalization failed: {e}", exc_info=True)
        db.rollback()
        raise
    finally:
        if close_db:
            db.close()


def _extract_rules_from_description(description: str) -> list:
    """Extract rule texts from numbered or bulleted lists in description."""
    rules = []
    for line in description.split("\n"):
        line = line.strip()
        # Match "1. Rule text" or "- Rule text"
        if line and (line[0].isdigit() and ". " in line[:4]):
            text = line[line.index(". ") + 2:]
            if len(text) > 20:
                rules.append(text)
        elif line.startswith("- ") and len(line) > 22:
            rules.append(line[2:])
    return rules


if __name__ == "__main__":
    normalize_project_cards(PROJECT_ID)
