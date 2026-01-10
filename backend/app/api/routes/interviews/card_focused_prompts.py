"""
Card-Focused AI Prompts - PROMPT #98
Tailored AI prompts for different card motivation types.

Each prompt focuses on relevant areas for bug/feature/design/documentation/etc card types.
Prompts are contextualized with motivation type, parent card (Epic/Story/Task), and previous answers.
"""

from typing import Optional
from app.models.project import Project
from app.models.task import Task


def build_card_focused_prompt(
    project: Project,
    motivation_type: str,
    card_title: str,
    card_description: str,
    message_count: int,
    parent_card: Optional[Task] = None,
    stack_context: str = ""
) -> str:
    """
    Build AI prompt for card-focused interviews based on motivation type.
    PROMPT #98 - Card-Focused Interview System

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

    Returns:
        System prompt string tailored for motivation type
    """
    question_num = (message_count // 2) + 1

    # Project context
    project_context = f"""
INFORMAÇÕES DO PROJETO:
- Nome: {project.name}
- Descrição: {project.description}
{stack_context}
"""

    # Parent card context
    parent_context = ""
    if parent_card:
        parent_type = parent_card.item_type or "card"
        parent_context = f"""
CARD PAI (CONTEXTO):
- Tipo: {parent_type}
- Título: {parent_card.title}
- Descrição: {parent_card.description or "Não especificado"}
"""

    # Card info
    card_info = f"""
CARD ATUAL:
- Tipo: {motivation_type}
- Título: {card_title}
- Descrição: {card_description}
"""

    motivation_type = motivation_type.lower()

    if motivation_type == "bug":
        return f"""{project_context}{parent_context}{card_info}

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
        return f"""{project_context}{parent_context}{card_info}

**TIPO DE TRABALHO: NEW FEATURE ✨**

Você está coletando informações para criar uma nova funcionalidade.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **User Story**: Quem precisa? Para que? Qual benefício?
2. **Funcionalidade**: O que a feature FAZ exatamente?
3. **Critérios de Aceitação**: Como saber que está completa/funcionando?
4. **Entrada/Saída**: Que dados recebe? Que dados retorna?
5. **Integrações**: Depende de outras features? APIs externas?
6. **Edge Cases**: Casos especiais? Validações? Erros possíveis?
7. **UI/UX**: Como usuário interage? (se aplicável)

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em NEW FEATURE]

**Regras:**
- Uma pergunta por vez, FOCADA em nova feature
- Construa contexto com respostas anteriores
- Após 6-10 perguntas, conclua com resumo da feature
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para definir a FEATURE!
"""

    elif motivation_type == "bugfix":
        return f"""{project_context}{parent_context}{card_info}

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
        return f"""{project_context}{parent_context}{card_info}

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
        return f"""{project_context}{parent_context}{card_info}

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
        return f"""{project_context}{parent_context}{card_info}

**TIPO DE TRABALHO: ENHANCEMENT ⚡**

Você está coletando informações para melhorar uma funcionalidade existente.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Funcionalidade Atual**: O que existe hoje? Como funciona?
2. **Limitação/Problema**: O que precisa ser melhorado? Por quê?
3. **Melhoria Desejada**: Como deve funcionar após melhoria?
4. **Benefícios**: Que problema resolve? Que valor agrega?
5. **Comportamento Preservado**: O que NÃO deve mudar?
6. **Casos de Uso**: Novos cenários suportados?
7. **Retrocompatibilidade**: Usuários/sistemas existentes afetados?

**Formato de Pergunta:**
❓ Pergunta {question_num}: [Sua pergunta focada em ENHANCEMENT]

**Regras:**
- Uma pergunta por vez, FOCADA em enhancement
- Construa contexto com respostas anteriores
- Após 5-8 perguntas, conclua com resumo
- Se resposta for genérica/vaga, peça especificidade

Continue com a próxima pergunta relevante para definir o ENHANCEMENT!
"""

    elif motivation_type == "refactor":
        return f"""{project_context}{parent_context}{card_info}

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
        return f"""{project_context}{parent_context}{card_info}

**TIPO DE TRABALHO: TESTING/QA ✅**

Você está coletando informações para adicionar testes ou melhorar cobertura.

**Foque nestas áreas (não pergunte tudo de uma vez):**
1. **Cobertura Atual**: Qual é a cobertura atual? Que áreas faltam testes?
2. **Gaps**: Que cenários críticos não têm testes?
3. **Estratégia**: Que tipo de testes adicionar? (unit, integration, e2e)
4. **Criterios**: Qual é o nível de cobertura alvo?
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
        return f"""{project_context}{parent_context}{card_info}

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
        return f"""{project_context}{parent_context}{card_info}

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
        return f"""{project_context}{parent_context}{card_info}

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
