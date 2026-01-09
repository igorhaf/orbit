"""
Context Building Utilities
PROMPT #69 - Refactor interviews.py

Functions for preparing interview context for AI to reduce token usage.
Includes task type extraction from user answers.
"""

import logging
import re
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


def prepare_interview_context(conversation_data: List[Dict], max_recent: int = 5) -> List[Dict]:
    """
    Prepare efficient context for AI to reduce token usage.

    Strategy (PROMPT #54 - Token Cost Optimization):
    - For short conversations (≤ max_recent messages): Send all verbatim
    - For long conversations (> max_recent messages):
        * Summarize older messages into bullets (role + first 100 chars)
        * Send recent messages verbatim

    This reduces token usage by 60-70% for longer interviews while maintaining
    context quality by preserving recent conversation in full.

    Args:
        conversation_data: Full conversation history from interview
        max_recent: Number of recent messages to keep verbatim (default: 5)

    Returns:
        Optimized message list: [summary_message] + recent_messages

    Example:
        12 messages conversation:
        - Messages 1-7 → 1 summary message (~200 tokens)
        - Messages 8-12 → 5 verbatim messages (~2,000 tokens)
        Total: ~2,200 tokens instead of ~8,000 tokens (73% reduction)
    """
    # Short conversation - send all messages verbatim
    if len(conversation_data) <= max_recent:
        logger.info(f"📝 Short conversation ({len(conversation_data)} msgs), sending all verbatim")
        return [{"role": msg["role"], "content": msg["content"]} for msg in conversation_data]

    # Long conversation - summarize older + verbatim recent
    older_messages = conversation_data[:-max_recent]
    recent_messages = conversation_data[-max_recent:]

    logger.info(f"📝 Long conversation ({len(conversation_data)} msgs):")
    logger.info(f"   - Summarizing older: {len(older_messages)} messages")
    logger.info(f"   - Keeping verbatim: {len(recent_messages)} recent messages")

    # Create compact summary of older context
    summary_points = []
    for i, msg in enumerate(older_messages):
        role = msg.get('role', 'unknown')
        content = msg.get('content', '')
        # Take first 100 chars to avoid summary being too long
        content_preview = content[:100] + ('...' if len(content) > 100 else '')
        summary_points.append(f"[{i+1}] {role}: {content_preview}")

    # IMPORTANT: Anthropic API only accepts "user" and "assistant" roles
    # Cannot use "system" role in messages array - it must be in system parameter
    summary_message = {
        "role": "user",
        "content": f"""[CONTEXTO ANTERIOR - RESUMO]

Resumo das {len(older_messages)} mensagens anteriores desta entrevista:

{chr(10).join(summary_points)}

As {len(recent_messages)} mensagens mais recentes seguem abaixo com conteúdo completo."""
    }

    # Build optimized message list
    optimized_messages = [summary_message] + [
        {"role": msg["role"], "content": msg["content"]}
        for msg in recent_messages
    ]

    logger.info(f"✅ Context optimized: {len(conversation_data)} msgs → {len(optimized_messages)} msgs")
    logger.info(f"   Estimated token reduction: ~60-70%")

    return optimized_messages


def extract_task_type_from_answer(user_answer: str) -> Optional[str]:
    """
    Extract task type from user's answer to Q1 in task-focused interview.
    PROMPT #68 - Dual-Mode Interview System

    Args:
        user_answer: User's text answer

    Returns:
        Task type ("bug" | "feature" | "refactor" | "enhancement") or None
    """
    answer_lower = user_answer.lower()

    # Match against task type keywords
    if re.search(r'\b(bug|bugfix|bug fix|erro|error)\b', answer_lower):
        logger.info(f"Detected task type: bug")
        return "bug"
    elif re.search(r'\b(feature|funcionalidade|nova feature|new feature)\b', answer_lower):
        logger.info(f"Detected task type: feature")
        return "feature"
    elif re.search(r'\b(refactor|refatorar|refactoring)\b', answer_lower):
        logger.info(f"Detected task type: refactor")
        return "refactor"
    elif re.search(r'\b(enhancement|melhoria|improve|improvement|aprimorar)\b', answer_lower):
        logger.info(f"Detected task type: enhancement")
        return "enhancement"
    else:
        logger.warning(f"Could not detect task type from answer: {user_answer[:50]}")
        return "feature"  # Default fallback


def build_business_section_prompt(project, question_num: int) -> str:
    """
    Build prompt for BUSINESS section of orchestrator interview.
    PROMPT #94 FASE 3 - Specialized sections in orchestrator mode

    This section focuses on business rules, logic, and domain knowledge.
    ALWAYS applied regardless of stack (business rules exist in all projects).

    Args:
        project: Project instance
        question_num: Current question number

    Returns:
        System prompt string for business-focused questions
    """
    return f"""
INFORMAÇÕES DO PROJETO:
- Nome: {project.name}
- Descrição: {project.description}

**SEÇÃO ESPECIALIZADA: BUSINESS - Regras de Negócio 💼**

Você está na fase de perguntas sobre **REGRAS DE NEGÓCIO** e **LÓGICA DO DOMÍNIO**.

**FOCO DESTA SEÇÃO (não pergunte tudo de uma vez):**
1. **Regras de Validação**: Quais validações de negócio? (ex: CPF único, idade mínima, limite de crédito)
2. **Fluxos de Trabalho**: Sequências/etapas obrigatórias? (ex: pedido → pagamento → envio)
3. **Permissões e Acesso**: Quem pode fazer o quê? Níveis de acesso?
4. **Cálculos e Fórmulas**: Regras de cálculo? (ex: desconto, frete, impostos, comissão)
5. **Estados e Transições**: Quais status? Transições permitidas? (ex: rascunho → publicado → arquivado)
6. **Integrações de Negócio**: APIs externas necessárias? (pagamento, envio, email, SMS)
7. **Dados Críticos**: Entidades principais? Relacionamentos? (ex: User → Order → Product)

**FORMATO DE PERGUNTA:**
❓ Pergunta {question_num}: [Sua pergunta focada em REGRAS DE NEGÓCIO]

Para ESCOLHA ÚNICA:
○ Opção 1
○ Opção 2
○ Opção 3

Para MÚLTIPLA ESCOLHA:
☐ Opção 1
☐ Opção 2
☐ Opção 3
☑️ [Selecione todas que se aplicam]

**REGRAS:**
- Uma pergunta por vez, FOCADA em regras de negócio
- Construa contexto com respostas anteriores
- Sempre forneça opções (nunca perguntas abertas!)
- Após 4-6 perguntas sobre negócio, mova para próxima seção

**EXEMPLOS DE BOAS PERGUNTAS:**

✅ BOM (Validação de negócio):
❓ Quais validações devem ser aplicadas ao criar um novo usuário?

☐ Email único (não pode repetir)
☐ CPF/CNPJ válido
☐ Idade mínima (ex: 18 anos)
☐ Telefone obrigatório
☐ Senha forte (mínimo 8 caracteres)

☑️ Selecione todas que se aplicam.

✅ BOM (Fluxo de trabalho):
❓ Qual o fluxo de status de um pedido?

○ Simples: pendente → pago → entregue
○ Completo: pendente → confirmado → pago → em separação → enviado → entregue
○ Complexo: pendente → em análise → aprovado → pago → em produção → enviado → entregue
○ Customizado (especificar depois)

Continue com a próxima pergunta relevante sobre REGRAS DE NEGÓCIO!
"""


def build_design_section_prompt(project, question_num: int) -> str:
    """
    Build prompt for DESIGN section of orchestrator interview.
    PROMPT #94 FASE 3 - Specialized sections in orchestrator mode

    This section focuses on UX/UI, visual design, and web design aspects.
    ONLY applied if project has frontend (stack_frontend) OR CSS framework (stack_css).

    Args:
        project: Project instance
        question_num: Current question number

    Returns:
        System prompt string for design-focused questions
    """
    return f"""
INFORMAÇÕES DO PROJETO:
- Nome: {project.name}
- Descrição: {project.description}
- Frontend: {project.stack_frontend or 'Não especificado'}
- CSS: {project.stack_css or 'Não especificado'}

**SEÇÃO ESPECIALIZADA: DESIGN - UX/UI e Design Visual 🎨**

Você está na fase de perguntas sobre **EXPERIÊNCIA DO USUÁRIO (UX)**, **INTERFACE (UI)** e **DESIGN VISUAL**.

**FOCO DESTA SEÇÃO (não pergunte tudo de uma vez):**
1. **Layout e Estrutura**: Como organizar a interface? (dashboard, sidebar, top nav, cards)
2. **Tema e Estilo**: Qual identidade visual? (cores, fontes, espaçamentos, bordas)
3. **Componentes UI**: Quais componentes necessários? (botões, forms, modais, tabelas, gráficos)
4. **Responsividade**: Comportamento em mobile/tablet/desktop? Breakpoints?
5. **Navegação**: Como usuário navega? Menu? Breadcrumbs? Tabs?
6. **Feedback Visual**: Loading states? Mensagens de sucesso/erro? Tooltips?
7. **Acessibilidade**: Suporte a screen readers? Contraste? Teclado?

**FORMATO DE PERGUNTA:**
❓ Pergunta {question_num}: [Sua pergunta focada em UX/UI/DESIGN]

Para ESCOLHA ÚNICA:
○ Opção 1
○ Opção 2
○ Opção 3

Para MÚLTIPLA ESCOLHA:
☐ Opção 1
☐ Opção 2
☐ Opção 3
☑️ [Selecione todas que se aplicam]

**REGRAS:**
- Uma pergunta por vez, FOCADA em UX/UI/design
- Construa contexto com respostas anteriores
- Sempre forneça opções (nunca perguntas abertas!)
- Após 3-5 perguntas sobre design, mova para próxima seção (se houver)

**EXEMPLOS DE BOAS PERGUNTAS:**

✅ BOM (Layout):
❓ Qual layout principal você prefere para o dashboard?

○ Sidebar fixa + conteúdo principal (estilo admin)
○ Top navigation + cards em grid (estilo moderno)
○ Sidebar retrátil + tabbed content (estilo workspace)
○ Single page com sections verticais (estilo landing)

✅ BOM (Componentes):
❓ Quais componentes de UI você precisa no projeto?

☐ Tabelas com paginação e filtros
☐ Formulários multi-step
☐ Modais e dialogs
☐ Gráficos e charts
☐ Upload de arquivos com preview
☐ Editor de texto rico (WYSIWYG)

☑️ Selecione todas que se aplicam.

✅ BOM (Tema):
❓ Qual paleta de cores deseja para a interface?

○ Azul profissional (corporativo, confiável)
○ Verde/roxo moderno (tech, inovador)
○ Tons neutros (minimalista, clean)
○ Personalizada baseada em brand

Continue com a próxima pergunta relevante sobre UX/UI/DESIGN!
"""


def build_mobile_section_prompt(project, question_num: int) -> str:
    """
    Build prompt for MOBILE section of orchestrator interview.
    PROMPT #94 FASE 3 - Specialized sections in orchestrator mode

    This section focuses on mobile-specific features, navigation, and UX patterns.
    ONLY applied if project has mobile stack (stack_mobile).

    Args:
        project: Project instance
        question_num: Current question number

    Returns:
        System prompt string for mobile-focused questions
    """
    return f"""
INFORMAÇÕES DO PROJETO:
- Nome: {project.name}
- Descrição: {project.description}
- Mobile Framework: {project.stack_mobile or 'Não especificado'}

**SEÇÃO ESPECIALIZADA: MOBILE - Desenvolvimento Mobile Específico 📱**

Você está na fase de perguntas sobre **DESENVOLVIMENTO MOBILE**, **NAVEGAÇÃO** e **EXPERIÊNCIA MOBILE**.

**FOCO DESTA SEÇÃO (não pergunte tudo de uma vez):**
1. **Navegação Mobile**: Qual padrão de navegação? (tabs, drawer, stack, bottom nav)
2. **Recursos Nativos**: Quais features nativas? (câmera, GPS, push, biometria, contatos)
3. **Offline First**: Funcionamento offline? Sincronização? Cache local?
4. **Gestos e Interações**: Swipe, pull-to-refresh, long-press, pinch-zoom?
5. **Performance Mobile**: Lista grande (virtualized)? Imagens otimizadas? Lazy loading?
6. **Plataformas**: iOS e Android? Comportamentos específicos por plataforma?
7. **Push Notifications**: Tipos de notificação? Frequência? Deep linking?

**FORMATO DE PERGUNTA:**
❓ Pergunta {question_num}: [Sua pergunta focada em MOBILE]

Para ESCOLHA ÚNICA:
○ Opção 1
○ Opção 2
○ Opção 3

Para MÚLTIPLA ESCOLHA:
☐ Opção 1
☐ Opção 2
☐ Opção 3
☑️ [Selecione todas que se aplicam]

**REGRAS:**
- Uma pergunta por vez, FOCADA em mobile
- Construa contexto com respostas anteriores
- Sempre forneça opções (nunca perguntas abertas!)
- Após 3-5 perguntas sobre mobile, conclua esta seção

**EXEMPLOS DE BOAS PERGUNTAS:**

✅ BOM (Navegação):
❓ Qual padrão de navegação mobile você prefere?

○ Bottom Tabs (tabs fixas na parte inferior - padrão iOS)
○ Drawer Menu (menu lateral deslizante)
○ Stack Navigation (telas empilhadas com botão voltar)
○ Híbrido (tabs principais + drawer para secundárias)

✅ BOM (Recursos nativos):
❓ Quais recursos nativos do dispositivo você precisa?

☐ Câmera (foto/vídeo)
☐ Galeria de fotos
☐ GPS / Localização
☐ Push Notifications
☐ Biometria (Face ID / Touch ID)
☐ Contatos do telefone
☐ Compartilhamento (share sheet)

☑️ Selecione todas que se aplicam.

✅ BOM (Offline):
❓ Como o app deve funcionar offline?

○ Totalmente online (requer internet sempre)
○ Visualização offline (leitura de dados cacheados)
○ Offline first (cria/edita offline, sincroniza depois)
○ Híbrido (algumas telas offline, outras online)

Continue com a próxima pergunta relevante sobre MOBILE!
"""
