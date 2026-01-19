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

    ⚠️ IMPORTANT (PROMPT #82):
    This function is ONLY used for TASK EXECUTION CHAT, NOT for interviews!
    - Interviews always send FULL context (no summarization) to avoid question repetition
    - This optimization is only applied to long task execution conversations

    Strategy (PROMPT #54 - Token Cost Optimization):
    - For short conversations (≤ max_recent messages): Send all verbatim
    - For long conversations (> max_recent messages):
        * Summarize older messages into bullets (role + first 100 chars)
        * Send recent messages verbatim

    This reduces token usage by 60-70% for longer conversations while maintaining
    context quality by preserving recent conversation in full.

    Args:
        conversation_data: Full conversation history
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
        "content": f"""[PREVIOUS CONTEXT - SUMMARY]

Summary of the {len(older_messages)} previous messages from this interview:

{chr(10).join(summary_points)}

The {len(recent_messages)} most recent messages follow below with full content."""
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
PROJECT INFO:
- Name: {project.name}
- Description: {project.description}

**SPECIALIZED SECTION: BUSINESS - Business Rules 💼**

You are in the phase of questions about **BUSINESS RULES** and **DOMAIN LOGIC**.

**FOCUS OF THIS SECTION (don't ask everything at once):**
1. **Validation Rules**: What business validations? (e.g.: unique ID, minimum age, credit limit)
2. **Workflows**: Mandatory sequences/steps? (e.g.: order → payment → shipping)
3. **Permissions and Access**: Who can do what? Access levels?
4. **Calculations and Formulas**: Calculation rules? (e.g.: discount, shipping, taxes, commission)
5. **States and Transitions**: What statuses? Allowed transitions? (e.g.: draft → published → archived)
6. **Business Integrations**: External APIs needed? (payment, shipping, email, SMS)
7. **Critical Data**: Main entities? Relationships? (e.g.: User → Order → Product)

**QUESTION FORMAT:**
❓ Pergunta {question_num}: [Your question focused on BUSINESS RULES in Portuguese]

For SINGLE CHOICE:
○ Option 1
○ Option 2
○ Option 3

For MULTIPLE CHOICE:
☐ Option 1
☐ Option 2
☐ Option 3
☑️ [Select all that apply]

**RULES:**
- One question at a time, FOCUSED on business rules
- Build context with previous answers
- Always provide options (never open-ended questions!)
- After 4-6 business questions, move to next section

**EXAMPLES OF GOOD QUESTIONS:**

✅ GOOD (Business validation):
❓ Quais validações devem ser aplicadas ao criar um novo usuário?

☐ Email único (não pode repetir)
☐ CPF/CNPJ válido
☐ Idade mínima (ex: 18 anos)
☐ Telefone obrigatório
☐ Senha forte (mínimo 8 caracteres)

☑️ Selecione todas que se aplicam.

✅ GOOD (Workflow):
❓ Qual o fluxo de status de um pedido?

○ Simples: pendente → pago → entregue
○ Completo: pendente → confirmado → pago → em separação → enviado → entregue
○ Complexo: pendente → em análise → aprovado → pago → em produção → enviado → entregue
○ Customizado (especificar depois)

**OUTPUT LANGUAGE: Portuguese (Brazilian).** Continue with the next relevant question about BUSINESS RULES!
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
PROJECT INFO:
- Name: {project.name}
- Description: {project.description}
- Frontend: {project.stack_frontend or 'Not specified'}
- CSS: {project.stack_css or 'Not specified'}

**SPECIALIZED SECTION: DESIGN - UX/UI and Visual Design 🎨**

You are in the phase of questions about **USER EXPERIENCE (UX)**, **INTERFACE (UI)** and **VISUAL DESIGN**.

**FOCUS OF THIS SECTION (don't ask everything at once):**
1. **Layout and Structure**: How to organize the interface? (dashboard, sidebar, top nav, cards)
2. **Theme and Style**: What visual identity? (colors, fonts, spacing, borders)
3. **UI Components**: What components needed? (buttons, forms, modals, tables, charts)
4. **Responsiveness**: Behavior on mobile/tablet/desktop? Breakpoints?
5. **Navigation**: How does user navigate? Menu? Breadcrumbs? Tabs?
6. **Visual Feedback**: Loading states? Success/error messages? Tooltips?
7. **Accessibility**: Screen reader support? Contrast? Keyboard?

**QUESTION FORMAT:**
❓ Pergunta {question_num}: [Your question focused on UX/UI/DESIGN in Portuguese]

For SINGLE CHOICE:
○ Option 1
○ Option 2
○ Option 3

For MULTIPLE CHOICE:
☐ Option 1
☐ Option 2
☐ Option 3
☑️ [Select all that apply]

**RULES:**
- One question at a time, FOCUSED on UX/UI/design
- Build context with previous answers
- Always provide options (never open-ended questions!)
- After 3-5 design questions, move to next section (if any)

**EXAMPLES OF GOOD QUESTIONS:**

✅ GOOD (Layout):
❓ Qual layout principal você prefere para o dashboard?

○ Sidebar fixa + conteúdo principal (estilo admin)
○ Top navigation + cards em grid (estilo moderno)
○ Sidebar retrátil + tabbed content (estilo workspace)
○ Single page com sections verticais (estilo landing)

✅ GOOD (Components):
❓ Quais componentes de UI você precisa no projeto?

☐ Tabelas com paginação e filtros
☐ Formulários multi-step
☐ Modais e dialogs
☐ Gráficos e charts
☐ Upload de arquivos com preview
☐ Editor de texto rico (WYSIWYG)

☑️ Selecione todas que se aplicam.

✅ GOOD (Theme):
❓ Qual paleta de cores deseja para a interface?

○ Azul profissional (corporativo, confiável)
○ Verde/roxo moderno (tech, inovador)
○ Tons neutros (minimalista, clean)
○ Personalizada baseada em brand

**OUTPUT LANGUAGE: Portuguese (Brazilian).** Continue with the next relevant question about UX/UI/DESIGN!
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
PROJECT INFO:
- Name: {project.name}
- Description: {project.description}
- Mobile Framework: {project.stack_mobile or 'Not specified'}

**SPECIALIZED SECTION: MOBILE - Mobile-Specific Development 📱**

You are in the phase of questions about **MOBILE DEVELOPMENT**, **NAVIGATION** and **MOBILE EXPERIENCE**.

**FOCUS OF THIS SECTION (don't ask everything at once):**
1. **Mobile Navigation**: What navigation pattern? (tabs, drawer, stack, bottom nav)
2. **Native Resources**: What native features? (camera, GPS, push, biometrics, contacts)
3. **Offline First**: Offline operation? Sync? Local cache?
4. **Gestures and Interactions**: Swipe, pull-to-refresh, long-press, pinch-zoom?
5. **Mobile Performance**: Large lists (virtualized)? Optimized images? Lazy loading?
6. **Platforms**: iOS and Android? Platform-specific behaviors?
7. **Push Notifications**: Notification types? Frequency? Deep linking?

**QUESTION FORMAT:**
❓ Pergunta {question_num}: [Your question focused on MOBILE in Portuguese]

For SINGLE CHOICE:
○ Option 1
○ Option 2
○ Option 3

For MULTIPLE CHOICE:
☐ Option 1
☐ Option 2
☐ Option 3
☑️ [Select all that apply]

**RULES:**
- One question at a time, FOCUSED on mobile
- Build context with previous answers
- Always provide options (never open-ended questions!)
- After 3-5 mobile questions, conclude this section

**EXAMPLES OF GOOD QUESTIONS:**

✅ GOOD (Navigation):
❓ Qual padrão de navegação mobile você prefere?

○ Bottom Tabs (tabs fixas na parte inferior - padrão iOS)
○ Drawer Menu (menu lateral deslizante)
○ Stack Navigation (telas empilhadas com botão voltar)
○ Híbrido (tabs principais + drawer para secundárias)

✅ GOOD (Native resources):
❓ Quais recursos nativos do dispositivo você precisa?

☐ Câmera (foto/vídeo)
☐ Galeria de fotos
☐ GPS / Localização
☐ Push Notifications
☐ Biometria (Face ID / Touch ID)
☐ Contatos do telefone
☐ Compartilhamento (share sheet)

☑️ Selecione todas que se aplicam.

✅ GOOD (Offline):
❓ Como o app deve funcionar offline?

○ Totalmente online (requer internet sempre)
○ Visualização offline (leitura de dados cacheados)
○ Offline first (cria/edita offline, sincroniza depois)
○ Híbrido (algumas telas offline, outras online)

**OUTPUT LANGUAGE: Portuguese (Brazilian).** Continue with the next relevant question about MOBILE!
"""
