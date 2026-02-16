"""
Card-Focused AI Prompts - PROMPT #98
Tailored AI prompts for different card motivation types.

Each prompt focuses on relevant áreas for bug/feature/design/documentation/etc card types.
Prompts are contextualized with motivation type, parent card (Epic/Story/Task), and previous answers.

PROMPT #132 - Enhanced to include full hierarchy context (Epic → Story → Task → Subtask)
"""

from typing import Optional, List
from sqlalchemy.orm import Session
from app.models.project import Project
from app.models.task import Task


def get_card_hierarchy(task: Task, db: Session) -> List[Task]:
    """
    PROMPT #132 - Get full hierarchy chain from current card up to root (Epic).

    Returns list ordered from root (Epic) to immediate parent.
    Example: [Epic, Story, Task] for a Subtask

    Args:
        task: Current task to get hierarchy for
        db: Database session

    Returns:
        List of parent tasks from root to immediate parent
    """
    hierarchy = []
    current = task

    # Walk up the tree until we hit root (no parent)
    while current and current.parent_id:
        parent = db.query(Task).filter(Task.id == current.parent_id).first()
        if parent:
            hierarchy.insert(0, parent)  # Insert at beginning to maintain order
            current = parent
        else:
            break

    return hierarchy


def build_hierarchy_context(hierarchy: List[Task]) -> str:
    """
    PROMPT #132 - Build human-readable hierarchy context section.
    PROMPT #198 - Proportional weighting: closer parents get more detail.

    Shows the full path from Epic down to the current card's parent.
    The immediate parent (last in list) gets the most detail (~40%),
    grandparent gets medium detail (~30%), great-grandparent gets
    minimal detail (~20%), and further ancestors get title only.

    Args:
        hierarchy: List of parent tasks from root to immediate parent

    Returns:
        Formatted hierarchy context string
    """
    if not hierarchy:
        return ""

    # Type icons for visual clarity
    type_icons = {
        "epic": "🎯",
        "story": "📖",
        "task": "✓",
        "subtask": "◦",
        "bug": "🐛"
    }

    context = """
═══════════════════════════════════════════════════════════════
📊 HIERARQUIA DO CARD (CONTEXTO PROPORCIONAL)
═══════════════════════════════════════════════════════════════
"""

    total_levels = len(hierarchy)

    for i, card in enumerate(hierarchy):
        item_type = (card.item_type or "task").lower()
        icon = type_icons.get(item_type, "•")
        indent = "  " * i

        # PROMPT #198 - Weight based on distance from current card
        # Last item = immediate parent = highest weight
        distance_from_current = total_levels - i

        if distance_from_current == 1:
            # HIGH (~40%) - Immediate parent: full detail
            context += f"""
{indent}{icon} **{item_type.upper()} [CONTEXTO PRINCIPAL]**: {card.title}
{indent}   Descrição: {card.description or 'Não especificado'}
"""
            if card.acceptance_criteria and len(card.acceptance_criteria) > 0:
                criteria_list = "\n".join([f"{indent}     - {c}" for c in card.acceptance_criteria])
                context += f"{indent}   Critérios de Aceitação:\n{criteria_list}\n"
            if card.story_points:
                context += f"{indent}   Story Points: {card.story_points}\n"
            if card.labels and len(card.labels) > 0:
                context += f"{indent}   Labels: {', '.join(card.labels)}\n"
            if card.generated_prompt:
                context += f"{indent}   Prompt Gerado: {card.generated_prompt[:500]}{'...' if len(card.generated_prompt) > 500 else ''}\n"

        elif distance_from_current == 2:
            # MEDIUM (~30%) - Grandparent: summarized
            desc = (card.description or 'Não especificado')[:300]
            ellipsis = '...' if card.description and len(card.description) > 300 else ''
            context += f"""
{indent}{icon} **{item_type.upper()} [CONTEXTO SECUNDÁRIO]**: {card.title}
{indent}   Descrição: {desc}{ellipsis}
"""
            if card.acceptance_criteria and len(card.acceptance_criteria) > 0:
                context += f"{indent}   Critérios de Aceitação: {len(card.acceptance_criteria)} definidos\n"
            if card.story_points:
                context += f"{indent}   Story Points: {card.story_points}\n"

        elif distance_from_current == 3:
            # LOW (~20%) - Great-grandparent: minimal
            desc = (card.description or 'Não especificado')[:150]
            ellipsis = '...' if card.description and len(card.description) > 150 else ''
            context += f"""
{indent}{icon} **{item_type.upper()} [REFERÊNCIA]**: {card.title}
{indent}   Descrição: {desc}{ellipsis}
"""

        else:
            # MINIMAL - Title only
            context += f"""
{indent}{icon} **{item_type.upper()}**: {card.title}
"""

    context += """
═══════════════════════════════════════════════════════════════
⚠️ PRIORIDADE DE CONTEXTO:
   - FOQUE PRINCIPALMENTE no card marcado [CONTEXTO PRINCIPAL] (pai imediato)
   - Use os níveis [CONTEXTO SECUNDÁRIO] e [REFERÊNCIA] como apoio
   - Suas perguntas devem ser ESPECÍFICAS para o nível atual, não genéricas
   - Complemente (não repita) informações já definidas nos níveis superiores
═══════════════════════════════════════════════════════════════
"""

    return context


def build_card_focused_prompt(
    project: Project,
    motivation_type: str,
    card_title: str,
    card_description: str,
    message_count: int,
    parent_card: Optional[Task] = None,
    stack_context: str = "",
    current_card: Optional[Task] = None,  # PROMPT #131 - Full card object for rich context
    hierarchy: Optional[List[Task]] = None  # PROMPT #132 - Full hierarchy chain
) -> str:
    """
    Build AI prompt for card-focused interviews based on motivation type.
    PROMPT #98 - Card-Focused Interview System
    PROMPT #131 - Enhanced to use full card content for contextual suggestions
    PROMPT #132 - Enhanced to include full hierarchy context (Epic → Story → Task)

    Generates prompts tailored for:
    - bug: Reprodução, ambiente, comportamento esperado vs atual
    - feature: User story, critérios de aceitação, integrações
    - bugfix: Reprodução, refactoring scope, comportamento preservado
    - design: Problemas atuais, padrões desejados, documentação
    - documentation: Escopo, estrutura, público-alvo
    - enhancement: Funcionalidade atual, limitações, melhoria desejada
    - refactor: Código atual, problemas, objetivo final
    - testing: Cobertura atual, gaps, estratégia de teste
    - optimization: Gargalos atuais, métricas alvo, impacto
    - security: Vulnerabilidades, ameaças, mitigações

    Args:
        project: Project instance
        motivation_type: Card motivation type (bug, feature, bugfix, design, etc.)
        card_title: Title of the card
        card_description: Description of the card
        message_count: Current message count (for question numbering)
        parent_card: Parent card (Epic, Story, or Task) for context
        stack_context: Optional stack context from project
        current_card: Full Task object for rich context (acceptance_criteria, story_points, etc.)
        hierarchy: Full hierarchy chain from Epic to immediate parent (PROMPT #132)

    Returns:
        System prompt string tailored for motivation type
    """
    question_num = (message_count // 2) + 1

    # PROMPT #198 - Proportional project context based on hierarchy depth
    hierarchy_depth = len(hierarchy) if hierarchy else 0

    if hierarchy_depth >= 3:
        # Subtask with Epic>Story>Task - project gets ~10% (name only)
        project_context = f"\nPROJETO: {project.name}\n"
    elif hierarchy_depth == 2:
        # Task with Epic>Story - project gets ~30%
        project_context = f"\nPROJETO: {project.name}\nDescrição: {(project.description or '')[:150]}\n"
    elif hierarchy_depth == 1:
        # Story with Epic - project gets ~60%
        project_context = f"""
INFORMAÇÕES DO PROJETO:
- Nome: {project.name}
- Descrição: {project.description or ''}
{stack_context}
"""
    else:
        # Epic or no hierarchy - project gets 100%
        project_context = f"""
INFORMAÇÕES DO PROJETO:
- Nome: {project.name}
- Descrição: {project.description}
{stack_context}
"""

    # PROMPT #132/198 - Proportional hierarchy context (Epic → Story → Task → current)
    hierarchy_context = ""
    if hierarchy and len(hierarchy) > 0:
        hierarchy_context = build_hierarchy_context(hierarchy)
    elif parent_card:
        # Fallback to single parent if hierarchy not provided
        parent_type = parent_card.item_type or "card"
        hierarchy_context = f"""
CARD PAI (CONTEXTO):
- Tipo: {parent_type}
- Título: {parent_card.title}
- Descrição: {parent_card.description or "Não especificado"}
"""

    # PROMPT #131 - Build rich card info from full Task object
    card_info = f"""
CARD ATUAL:
- Tipo: {motivation_type}
- Título: {card_title}
- Descrição: {card_description}
"""

    # PROMPT #131 - Add rich context if current_card is provided
    if current_card:
        # Acceptance criteria
        if current_card.acceptance_criteria and len(current_card.acceptance_criteria) > 0:
            criteria_list = "\n".join([f"  • {c}" for c in current_card.acceptance_criteria])
            card_info += f"""
CRITÉRIOS DE ACEITAÇÃO EXISTENTES:
{criteria_list}
"""

        # Story points
        if current_card.story_points:
            card_info += f"- Story Points: {current_card.story_points}\n"

        # Labels
        if current_card.labels and len(current_card.labels) > 0:
            card_info += f"- Labels: {', '.join(current_card.labels)}\n"

        # Item type
        if current_card.item_type:
            card_info += f"- Tipo de Item: {current_card.item_type}\n"

        # Priority
        if current_card.priority:
            priority_val = current_card.priority.value if hasattr(current_card.priority, 'value') else str(current_card.priority)
            card_info += f"- Prioridade: {priority_val}\n"

        # Generated prompt (if exists)
        if current_card.generated_prompt:
            card_info += f"""
PROMPT GERADO ANTERIORMENTE:
{current_card.generated_prompt[:500]}{'...' if len(current_card.generated_prompt) > 500 else ''}
"""

    motivation_type = motivation_type.lower()

    if motivation_type == "bug":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: BUG FIX 🐛**

Você está coletando informações para corrigir um bug/erro.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Reprodução**: Como reproduzir o bug? Passos específicos
2. **Ambiente**: Onde acontece? (dev/staging/production, browser, OS)
3. **Comportamento Esperado**: O que DEVERIA acontecer?
4. **Comportamento Atual**: O que ESTÁ acontecendo? (erros, screenshots, logs)
5. **Impacto**: Quem é afetado? Frequência? Urgência?
6. **Contexto Adicional**: Quando começou? Mudanças recentes?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em BUG FIX]

**Regras:**
- Uma pergunta por vez, FOCADA em bug fix
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua com resumo do bug
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para entender o BUG!
"""

    elif motivation_type == "feature":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: NEW FEATURE ✨**

Você está refinando uma funcionalidade existente ou coletando informações para uma nova.

**IMPORTANTE - MODO CONSULTIVO:**
Se o card já possui conteúdo (descrição, critérios de aceitação, etc.), você deve:
1. ANALISAR o conteúdo existente
2. IDENTIFICAR gaps ou informações faltantes
3. SUGERIR melhorias ou complementos específicos
4. PROPOR subtasks ou divisões do trabalho

**Áreas para explorar (baseado no que JÁ EXISTE no card):**
1. **Validação**: Os critérios de aceitação estão completos? Falta algo?
2. **Decomposição**: Essa feature pode ser dividida em subtasks menores?
3. **Edge Cases**: Há casos especiais não cobertos?
4. **Integrações**: Dependências não mencionadas?
5. **UI/UX**: Detalhes de interface faltando?
6. **Estimativa**: O story points está adequado?

**Formato de Pergunta/Sugestão:**
❓ Pergunta {question_num}: [Sua pergunta ou sugestão baseada no conteúdo existente]

💡 Você pode fazer perguntas OU propor sugestões como:
- "Notei que os critérios de aceitação não mencionam X. Sugiro adicionar..."
- "Essa feature parece grande. Sugiro dividir em: 1) ..., 2) ..., 3) ..."
- "Falta especificar o comportamento quando Y acontece. Como deve funcionar?"

**Regras:**
- ANÁLISE o conteúdo existente antes de perguntar
- Faça SUGESTÕES específicas quando apropriado
- Após 4-6 interações, PROPONHA um resumo das melhorias sugeridas
- Se o card estiver bem definido, CONFIRME e sugira próximos passos

Continue com a próxima pergunta ou sugestão relevante!
"""

    elif motivation_type == "bugfix":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: BUG FIX REFACTORING 🔧**

Você está coletando informações para corrigir E refatorar código problemático.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Reprodução**: Como reproduzir o bug?
2. **Análise**: Qual é o problema raiz? Por que existe?
3. **Refactoring Scope**: Que partes do código precisam ser refatoradas?
4. **Código Atual**: Estrutura atual, padrões usados?
5. **Código Desejado**: Padrões/estrutura desejada?
6. **Comportamento**: Funcionalidade deve permanecer EXATA (sem mudanças)?
7. **Testes**: Testes existentes? Precisam ser ajustados?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em BUG FIX + REFACTORING]

**Regras:**
- Uma pergunta por vez, equilibrando bug fix e refactor
- Construa contexto com respostas anteriores
- Após 6-9 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante!
"""

    elif motivation_type == "design":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: DESIGN/ARCHITECTURE 🎨**

Você está coletando informações para melhorar design ou arquitetura.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Problemas Atuais**: Que problemas existem no design/arquitetura atual?
2. **Limitações**: Que limitações o design atual impõe?
3. **Padrões Desejados**: Que padrões/princípios devem ser seguidos?
4. **Estrutura**: Como deve ser a nova estrutura?
5. **Impacto**: Que sistemas são afetados?
6. **Compatibilidade**: Retrocompatibilidade necessária?
7. **Documentação**: Que documentação será necessária?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em DESIGN/ARCHITECTURE]

**Regras:**
- Uma pergunta por vez, FOCADA em arquitetura/design
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para definir o DESIGN!
"""

    elif motivation_type == "documentation":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: DOCUMENTATION 📚**

Você está coletando informações para criar ou melhorar documentação.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Escopo**: O que precisa ser documentado? Que áreas?
2. **Público-Alvo**: Para quem é a documentação? (devs, users, devops, etc.)
3. **Estrutura**: Como deve ser organizada? (hierarquia, seções)
4. **Conteúdo**: Que tipos de informação incluir? (guias, exemplos, referência)
5. **Formato**: Que formato usar? (markdown, HTML, videos, etc.)
6. **Atualizações**: Com que frequência será atualizada?
7. **Exemplos**: Que exemplos práticos incluir?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em DOCUMENTATION]

**Regras:**
- Uma pergunta por vez, FOCADA em documentação
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para definir a DOCUMENTATION!
"""

    elif motivation_type == "enhancement":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: ENHANCEMENT ⚡**

Você está refinando uma melhoria existente ou coletando informações para uma nova.

**IMPORTANTE - MODO CONSULTIVO:**
Se o card já possui conteúdo (descrição, critérios de aceitação, etc.), você deve:
1. ANALISAR o conteúdo existente e identificar gaps
2. SUGERIR melhorias específicas baseadas no que já está documentado
3. PROPOR decomposição em subtasks menores se aplicável
4. VALIDAR se os critérios de aceitação cobrem todos os cenários

**Áreas para explorar (baseado no conteúdo existente):**
1. **Validação**: Os critérios cobrem comportamento preservado vs novo?
2. **Decomposição**: Pode ser dividido em entregas menores?
3. **Retrocompatibilidade**: Impactos não mencionados?
4. **Testes**: Cenários de teste especificados?
5. **Estimativa**: O story points está adequado para o escopo?

**Formato de Pergunta/Sugestão:**
❓ Pergunta {question_num}: [Sua pergunta ou sugestão baseada no conteúdo existente]

💡 Faça sugestões específicas quando apropriado:
- "Sugiro adicionar um critério de aceitação para retrocompatibilidade..."
- "Essa melhoria pode ser dividida em: 1) ..., 2) ..."
- "Falta especificar o que acontece com dados existentes..."

**Regras:**
- ANÁLISE o conteúdo existente antes de perguntar
- Faça SUGESTÕES específicas quando apropriado
- Após 4-6 interações, PROPONHA um resumo das melhorias
- Se estiver bem definido, CONFIRME e sugira próximos passos

Continue com a próxima pergunta ou sugestão relevante!
"""

    elif motivation_type == "refactor":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: REFACTORING ♻️**

Você está coletando informações para refatorar código existente.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Código Atual**: Que parte do código será refatorada? (arquivo, classe, função)
2. **Problemas**: O que está ruim? (duplicação, complexidade, performance, testes)
3. **Objetivo**: Como o código deve ficar após refactor?
4. **Comportamento**: Funcionalidade deve permanecer EXATA (sem mudanças)?
5. **Escopo**: Apenas refatorar ou incluir melhorias?
6. **Testes**: Testes existentes? Precisam ser ajustados?
7. **Impacto**: Outras partes dependem deste código?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em REFACTORING]

**Regras:**
- Uma pergunta por vez, FOCADA em refatoração
- Construa contexto com respostas anteriores
- Após 5-7 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para planejar o REFACTOR!
"""

    elif motivation_type == "testing":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: TESTING/QA ✅**

Você está coletando informações para adicionar testes ou melhorar cobertura.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Cobertura Atual**: Qual é a cobertura atual? Que áreas faltam testes?
2. **Gaps**: Que cenários críticos não têm testes?
3. **Estratégia**: Que tipo de testes adicionar? (unit, integration, e2e)
4. **Critérios**: Qual é o nível de cobertura alvo?
5. **Tipos de Teste**: Unit, integration, e2e, performance?
6. **Dados de Teste**: Que dados/fixtures são necessários?
7. **Automação**: Como serão executados? (CI/CD, manual)

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em TESTING]

**Regras:**
- Uma pergunta por vez, FOCADA em testes
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para definir a ESTRATÉGIA DE TESTES!
"""

    elif motivation_type == "optimization":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: OPTIMIZATION ⚙️**

Você está coletando informações para otimizar performance ou recursos.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Gargalos Atuais**: Qual é o problema de performance? Onde está?
2. **Métricas**: Quais métricas devem ser melhoradas? (latência, CPU, memória, etc.)
3. **Alvo**: Qual é a meta? (50% mais rápido, uso de RAM reduzido, etc.)
4. **Escopo**: Que partes otimizar? (queries, caching, índices, etc.)
5. **Impacto**: Que sistemas são afetados?
6. **Tradeoffs**: Que tradeoffs são aceitáveis? (memória vs CPU, etc.)
7. **Monitoramento**: Como será monitorada a melhoria?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em OPTIMIZATION]

**Regras:**
- Uma pergunta por vez, FOCADA em performance
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para definir a OTIMIZAÇÃO!
"""

    elif motivation_type == "security":
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: SECURITY 🔒**

Você está coletando informações para melhorias de segurança.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Vulnerabilidades**: Que vulnerabilidades foram identificadas?
2. **Ameaças**: Que ameaças/cenários de ataque existem?
3. **Mitigações**: Que mitigações são propostas?
4. **Escopo**: Quais componentes são afetados?
5. **Conformidade**: Que padrões/regulações se aplicam? (OWASP, GDPR, etc.)
6. **Impacto**: Como isso afeta usuários/performance?
7. **Auditoria**: Como será auditada/testada a segurança?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em SECURITY]

**Regras:**
- Uma pergunta por vez, FOCADA em segurança
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para definir a SEGURANÇA!
"""

    else:
        # Fallback: Generic card prompt
        return f"""{project_context}{hierarchy_context}{card_info}

**TIPO DE TRABALHO: {motivation_type.upper()}**

Você está coletando informações para uma tarefa.

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta]

**Regras:**
- Uma pergunta por vez
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua

Continue com a próxima pergunta relevante!
"""
