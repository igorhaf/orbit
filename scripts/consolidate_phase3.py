#!/usr/bin/env python3
"""
Consolidation Phase 3 — Full integration of NOVAS_REGRAS.MD content:
1. Update Epic-Rule links (add the 19 new rules to their epics)
2. Create new cards for behaviors not yet represented (Subtask, Bug, Relationships, etc.)
3. Create new wiki pages for topics discovered in NOVAS_REGRAS.MD
4. Enrich all new cards (AC, semantic prompts, expanded descriptions)
5. Index everything in RAG
Anti-duplication: check before every insert.
"""
import uuid
import json
import psycopg2
import requests
from datetime import datetime

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
OLLAMA_URL = "http://172.27.144.1:11434"
WIKI_DIR = "satellite/knowledge/wiki"
NOW = datetime.now().isoformat()

def get_embedding(text: str) -> list:
    resp = requests.post(f"{OLLAMA_URL}/api/embeddings", json={
        "model": "nomic-embed-text",
        "prompt": text[:2000]
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]

def embed_str(text: str) -> str:
    emb = get_embedding(text)
    return "[" + ",".join(str(x) for x in emb) + "]"


# ============================================================
# STEP 1: Update Epic-Rule links with the 19 new rules
# ============================================================
def step1_update_epic_rule_links(cur):
    print("\n=== STEP 1: Update Epic-Rule links ===")

    # Get all epics with their domain
    cur.execute("""
        SELECT id, title, generation_context
        FROM tasks
        WHERE project_id = %s AND item_type = 'epic'
    """, (PROJECT_ID,))
    epics = cur.fetchall()

    updated = 0
    for epic_id, epic_title, ctx_raw in epics:
        ctx = ctx_raw if isinstance(ctx_raw, dict) else (json.loads(ctx_raw) if ctx_raw else {})
        domain = ctx.get("domain", "")
        if not domain:
            continue

        # Fetch ALL rules for this domain (including the new ones)
        cur.execute("""
            SELECT id, metadata->>'title'
            FROM rag_documents
            WHERE project_id = %s
              AND metadata->>'type' = 'business_rule'
              AND metadata->>'source_domain' = %s
        """, (PROJECT_ID, domain))
        rules = cur.fetchall()

        if rules:
            ctx["related_rules"] = [{"id": str(r[0]), "title": r[1]} for r in rules]
            ctx["rules_count"] = len(rules)
            cur.execute("""
                UPDATE tasks SET generation_context = %s::json WHERE id = %s
            """, (json.dumps(ctx), epic_id))
            updated += 1
            print(f"  {epic_title}: {len(rules)} rules linked")

    # Special: Orquestração links both ai_orchestration + task_execution
    cur.execute("""
        SELECT id, generation_context FROM tasks
        WHERE project_id = %s AND title LIKE '%%Orquestração%%'
    """, (PROJECT_ID,))
    row = cur.fetchone()
    if row:
        orch_id, ctx_raw = row
        ctx = ctx_raw if isinstance(ctx_raw, dict) else (json.loads(ctx_raw) if ctx_raw else {})
        cur.execute("""
            SELECT id, metadata->>'title' FROM rag_documents
            WHERE project_id = %s AND metadata->>'type' = 'business_rule'
              AND metadata->>'source_domain' IN ('ai_orchestration', 'task_execution')
        """, (PROJECT_ID,))
        rules = cur.fetchall()
        ctx["related_rules"] = [{"id": str(r[0]), "title": r[1]} for r in rules]
        ctx["rules_count"] = len(rules)
        cur.execute("UPDATE tasks SET generation_context = %s::json WHERE id = %s",
                    (json.dumps(ctx), orch_id))
        print(f"  Orquestração: {len(rules)} rules (ai_orchestration + task_execution)")

    print(f"  Updated {updated} epics")


# ============================================================
# STEP 2: New cards for underrepresented behaviors
# ============================================================
NEW_CARDS = [
    # --- EPIC: Gestão de Projetos Core needs more stories ---
    {
        "parent_title": "Gestão de Projetos Core",
        "item_type": "story",
        "title": "Ciclo de Vida do Projeto e Travamento de Contexto",
        "description": (
            "Implementar o ciclo de vida completo do projeto: estados draft→processing→active sem transição retroativa. "
            "O contexto do projeto (context_semantic e context_human) é travado permanentemente (context_locked=true) "
            "quando o primeiro Epic é ativado — operação irreversível. "
            "Projeto em status 'processing' bloqueia edição. "
            "Wizard incompleto (fechar aba, refresh) dispara deleção automática do projeto. "
            "Projetos protegidos (protected=true) requerem desativação explícita antes da deleção. "
            "Implementação usa ProjectService, WorkflowValidator e job de cleanup para wizards abandonados."
        ),
        "priority": "high",
        "story_points": 8,
        "domain": "project_management",
    },
    {
        "parent_title": "Gestão de Projetos Core",
        "item_type": "task",
        "title": "Implementar context_locked: travamento irreversível do contexto",
        "description": (
            "Adicionar campo context_locked (boolean, default=false) ao modelo Project. "
            "Quando o primeiro Epic é ativado, setar context_locked=true via trigger de ativação. "
            "Bloquear qualquer UPDATE em context_semantic e context_human quando context_locked=true — "
            "retornar HTTP 409 com mensagem 'Contexto do projeto está travado'. "
            "Incluir verificação no ProjectService antes de qualquer atualização de contexto. "
            "Criar migration Alembic. Adicionar ao endpoint GET /projects/{id} o campo context_locked no response schema."
        ),
        "priority": "high",
        "story_points": 5,
        "domain": "project_management",
        "parent_story_title": "Ciclo de Vida do Projeto e Travamento de Contexto",
    },
    {
        "parent_title": "Gestão de Projetos Core",
        "item_type": "task",
        "title": "Wizard de criação: deleção automática em abandono de sessão",
        "description": (
            "Implementar cleanup de projetos incompletos (status='draft') criados há mais de 30 minutos. "
            "Job de background (prioridade LOW/3) verifica periodicamente projetos orphaned em draft. "
            "Frontend deve registrar heartbeat enquanto o usuário está no wizard. "
            "Se heartbeat parar (aba fechada, navegação, refresh), backend aguarda timeout e deleta o projeto draft. "
            "Usar endpoint DELETE /projects/{id} com cascade. Logar deleção como evento de sistema."
        ),
        "priority": "medium",
        "story_points": 5,
        "domain": "project_management",
        "parent_story_title": "Ciclo de Vida do Projeto e Travamento de Contexto",
    },

    # --- EPIC: Geração de Backlog — subtask level ---
    {
        "parent_title": "Geração Hierárquica de Backlog",
        "item_type": "story",
        "title": "Hierarquia Completa: Subtask como Nível Operacional",
        "description": (
            "Implementar o nível Subtask como folha terminal da hierarquia Epic→Story→Task→Subtask. "
            "Task gera automaticamente 3-5 Subtasks ao ser ativada (workflow_state draft→open). "
            "Subtask nunca tem filhos — WorkflowValidator rejeita qualquer tentativa de criar filhos de Subtask. "
            "Subtask ativada gera seu conteúdo completo (description, criteria, prompt) usando Semantic Reference Methodology. "
            "Subtask workflow: todo → in_progress → done (pode voltar in_progress→todo). "
            "Deleção de Task apaga todas as Subtasks filhas em cascata."
        ),
        "priority": "high",
        "story_points": 8,
        "domain": "backlog_generation",
    },
    {
        "parent_title": "Geração Hierárquica de Backlog",
        "item_type": "story",
        "title": "Rastreabilidade Bidirecional: Cards ↔ Entrevistas",
        "description": (
            "Implementar campos de rastreabilidade em Task: interview_insights (text) e interview_question_ids (array). "
            "Durante a geração de backlog a partir de entrevista, registrar quais perguntas e respostas geraram cada card. "
            "Isso garante rastreabilidade bidirecional: card→entrevista e entrevista→cards_gerados. "
            "batch_source (JSONB): registrar batch_number, files_processed, layer que criou o card. "
            "Todas as transições de status são logadas em StatusTransition com actor (human/ai/system), timestamp e reason. "
            "StatusTransitions deletadas em cascata com o card."
        ),
        "priority": "medium",
        "story_points": 5,
        "domain": "backlog_generation",
    },
    {
        "parent_title": "Geração Hierárquica de Backlog",
        "item_type": "task",
        "title": "Implementar tipo Bug com workflow próprio e campo severity",
        "description": (
            "Criar suporte ao tipo Bug como item filho de Story, paralelo ao Task. "
            "Bug tem workflow exclusivo: new → confirmed → in_progress → fixed → verified → closed. "
            "De 'fixed' é possível voltar para in_progress (reabertura) ou avançar. "
            "Bug é nó folha: não pode ter filhos de nenhum tipo. "
            "Campo severity (nullable): blocker, critical, major, minor, trivial — exclusivo para Bug. "
            "WorkflowValidator rejeita severity em Epic/Story/Task/Subtask. "
            "Reporter padrão = 'system'; aceita 'ai' e 'watchdog'. Assignee é nullable."
        ),
        "priority": "medium",
        "story_points": 5,
        "domain": "backlog_generation",
        "parent_story_title": "Hierarquia Completa: Subtask como Nível Operacional",
    },

    # --- EPIC: Kanban --- relacionamentos
    {
        "parent_title": "Sistema de Entrevistas Contextuais",
        "item_type": "story",
        "title": "Entrevista Focada em Card (Task-Focused Mode)",
        "description": (
            "Implementar o modo task_focused de entrevista: exige parent_task_id obrigatório na criação. "
            "Nesse modo, a entrevista gera sugestões de Subtasks para a Task pai — não trava o contexto do projeto. "
            "Se context_locked=true, o sistema redireciona tentativas de iniciar nova entrevista de contexto. "
            "Perguntas são de múltipla escolha com 5-8 opções (formato closed). "
            "Ao deletar uma Task, todas as entrevistas criadas a partir dela são deletadas em cascata. "
            "O inverso não é verdade: deletar a entrevista não exclui tasks geradas."
        ),
        "priority": "medium",
        "story_points": 5,
        "domain": "interviews",
    },

    # --- Jobs --- Prompt Queue
    {
        "parent_title": "Sistema de Jobs Assíncronos",
        "item_type": "story",
        "title": "Prompt Queue: Fila de Execução com Scoring Inteligente",
        "description": (
            "Implementar fila de execução de prompts com scoring baseado em 5 fatores: "
            "prioridade do card, nível hierárquico (Epic>Story>Task), idade do item, "
            "dependências não resolvidas (depends_on → item fica BLOCKED), e override manual. "
            "Override manual (drag-and-drop pelo usuário) seta manual_override=true e tem precedência absoluta. "
            "Fila reordena automaticamente ao adicionar novos itens. "
            "Itens BLOCKED não executam até todas as dependências atingirem status COMPLETED. "
            "Configuração via contrato: backend/contracts/business/queue_scoring.yaml."
        ),
        "priority": "high",
        "story_points": 8,
        "domain": "job_system",
    },

    # --- Watchdog ---
    {
        "parent_title": "Sistema de Jobs Assíncronos",
        "item_type": "task",
        "title": "Watchdog: limites de geração e enriquecimento por ciclo",
        "description": (
            "Implementar controles de limite no watchdog para evitar sobrecarga: "
            "Máximo 10 cards gerados por ciclo de execução (aumentado de 5 para 10 no PROMPT #228). "
            "Máximo 2 cards enriquecidos por ciclo idle (adicionar detalhes, contexto, critérios de aceite). "
            "Ciclos idle ocorrem quando não há jobs de prioridade alta pendentes. "
            "Limites configuráveis via contrato: backend/contracts/business/watchdog_limits.yaml. "
            "Logar no ConsoleLogger cada ciclo com: cards_generated, cards_enriched, cycle_duration_ms."
        ),
        "priority": "medium",
        "story_points": 3,
        "domain": "job_system",
        "parent_story_title": "Prompt Queue: Fila de Execução com Scoring Inteligente",
    },

    # --- Card Relationships ---
    {
        "parent_title": "Geração Hierárquica de Backlog",
        "item_type": "story",
        "title": "Relacionamentos entre Cards (blocks, depends_on, relates_to)",
        "description": (
            "Implementar relacionamentos JIRA-style entre cards via TaskRelationship model. "
            "Tipos suportados: blocks (este card bloqueia outro), depends_on (este depende de outro — "
            "respeitado pela Prompt Queue que bloqueia execução de dependentes não resolvidos), "
            "relates_to (relacionados sem bloqueio), duplicates (duplicata semântica), clones (cópia exata). "
            "Endpoint GET /tasks/blocked — lista todos os cards em status BLOCKED. "
            "Endpoint POST /tasks/{id}/relationships — cria relacionamento. "
            "Relacionamentos são exibidos no detalhe do card no frontend."
        ),
        "priority": "medium",
        "story_points": 5,
        "domain": "kanban",
    },
]

def step2_create_cards(cur):
    print("\n=== STEP 2: Create new cards ===")

    # Build lookup: title → id for tasks in this project
    cur.execute("""
        SELECT id, title, item_type FROM tasks WHERE project_id = %s
    """, (PROJECT_ID,))
    existing = {r[1]: r[0] for r in cur.fetchall()}
    existing_types = {r[1]: r[2] for r in cur.fetchall()}

    created = 0
    id_map = {}  # title → id (for parent lookups)

    for card in NEW_CARDS:
        if card["title"] in existing:
            print(f"  SKIP (exists): {card['title']}")
            id_map[card["title"]] = existing[card["title"]]
            continue

        # Find parent
        parent_id = None
        parent_lookup = card.get("parent_story_title") or card.get("parent_title")
        if parent_lookup:
            parent_id = existing.get(parent_lookup) or id_map.get(parent_lookup)
            if not parent_id:
                print(f"  WARNING: parent not found for '{card['title']}' (looked for '{parent_lookup}')")

        domain = card.get("domain", "project_management")
        item_type = card["item_type"]
        status = "backlog"
        column = "backlog"

        description = card["description"]
        story_points = card.get("story_points", 3)
        priority = card.get("priority", "medium")

        # Build generation_context
        ctx = {"domain": domain}

        # Add AC
        if item_type == "epic":
            ctx["acceptance_criteria"] = [
                {"id": "AC1", "criterion": f"Given the {domain.replace('_',' ')} system is deployed, when all stories under this epic are completed, then all features work end-to-end without regression.", "format": "given-when-then", "category": "completeness"},
                {"id": "AC2", "criterion": f"Given the system is running, when {card['title']} is fully operational, then all domain-specific business rules are enforced.", "format": "given-when-then", "category": "business_rules"},
            ]
        elif item_type == "story":
            ctx["acceptance_criteria"] = [
                {"id": "AC1", "criterion": f"Given a user with appropriate permissions, when they interact with {card['title']}, then the system responds correctly within 2 seconds.", "format": "given-when-then", "category": "functional"},
                {"id": "AC2", "criterion": f"Given invalid input, when the {card['title']} operation is triggered, then the system returns a descriptive error with HTTP 4xx and does not corrupt data.", "format": "given-when-then", "category": "error_handling"},
                {"id": "AC3", "criterion": f"Given the implementation is complete, when multiple consecutive requests are made, then outcomes are idempotent and system state remains consistent.", "format": "given-when-then", "category": "idempotency"},
            ]
        else:
            ctx["acceptance_criteria"] = [
                {"id": "AC1", "criterion": f"Given the implementation of {card['title']} is complete, when called with valid input, then it returns the expected output without exceptions.", "format": "given-when-then", "category": "implementation"},
                {"id": "AC2", "criterion": f"Given the code is merged, when existing tests run, then all tests pass and no pre-existing functionality is broken.", "format": "given-when-then", "category": "regression"},
                {"id": "AC3", "criterion": f"Given the feature is deployed, when it runs under load, then response time stays under 5 seconds and no errors occur.", "format": "given-when-then", "category": "performance"},
            ]

        # Add semantic prompt
        ctx["semantic_prompt"] = (
            f"CONTEXT:\nThe {domain.replace('_',' ')} domain of ORBIT. This {item_type} — \"{card['title']}\" — "
            f"addresses behaviors documented in NOVAS_REGRAS.MD and enforced by WorkflowValidator and ContractLoader.\n\n"
            f"DESCRIPTION:\n{description[:300]}\n\n"
            f"OBJECTIVE:\nImplement {card['title']} following ORBIT architecture: service layer, FastAPI router, "
            f"Pydantic schemas, Alembic migration if needed.\n\n"
            f"CONSTRAINTS:\n- REGRA #0: never overwrite human-edited data\n"
            f"- Use AIOrchestrator for all AI calls\n- Externalize any new prompts to YAML"
        )

        card_id = str(uuid.uuid4())
        sp_text = ctx.get("semantic_prompt", "")
        cur.execute("""
            INSERT INTO tasks (id, project_id, title, description, type, status, priority,
                               story_points, parent_id, "order", "column", item_type,
                               generation_context, generated_prompt, prompt_edited_by,
                               created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 0, %s, %s, %s::json, %s, 'ai', NOW(), NOW())
        """, (card_id, PROJECT_ID, card["title"], description,
              item_type, status, priority, story_points, parent_id,
              column, item_type, json.dumps(ctx), sp_text))

        # Index in RAG
        rag_content = (
            f"CARD [{item_type.upper()}]: {card['title']}\n"
            f"Domain: {domain}\nPriority: {priority}\nStory Points: {story_points}\n\n"
            f"{description}\n\n"
            f"AC1: {ctx['acceptance_criteria'][0]['criterion'][:100]}"
        )
        rag_meta = json.dumps({
            "type": "card",
            "card_id": card_id,
            "card_type": item_type,
            "domain": domain,
            "title": card["title"],
            "acceptance_criteria_count": len(ctx["acceptance_criteria"]),
            "has_semantic_prompt": True,
        })
        cur.execute("""
            INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at)
            VALUES (%s, %s, %s, %s::vector, %s::jsonb, NOW())
        """, (str(uuid.uuid4()), PROJECT_ID, rag_content, embed_str(rag_content), rag_meta))

        id_map[card["title"]] = card_id
        existing[card["title"]] = card_id
        created += 1
        print(f"  CREATED [{item_type}]: {card['title']}")

    print(f"  Total new cards: {created}")
    return id_map


# ============================================================
# STEP 3: New wiki pages from NOVAS_REGRAS.MD topics
# ============================================================
NEW_WIKI_PAGES = [
    {
        "slug": "hierarquia-cards",
        "title": "Hierarquia de Cards e Validação de Tipos",
        "order_index": 35,
        "content": """# Hierarquia de Cards e Validação de Tipos

## Estrutura em 4 Níveis

O ORBIT impõe uma hierarquia estrita e imutável para todos os itens do backlog:

```
Epic
  └── Story
        └── Task / Bug
              └── Subtask
```

**WorkflowValidator** aplica essas regras em todas as operações de criação — violations retornam HTTP 422.

## Regras por Tipo

| Tipo | Filhos Permitidos | É Folha? |
|------|------------------|---------|
| **Epic** | Story (apenas) | Não |
| **Story** | Task, Bug | Não |
| **Task** | Subtask (apenas) | Não |
| **Bug** | Nenhum | ✅ Sim |
| **Subtask** | Nenhum | ✅ Sim |

## Ativação e Geração de Filhos

A ativação de um card sugerido (`workflow_state='draft'`) dispara geração automática de filhos:

| Tipo Ativado | Gera | Quantidade |
|-------------|------|-----------|
| Epic | Stories (draft) | 15–20 |
| Story | Tasks (draft) | 5–8 |
| Task | Subtasks (draft) | 3–5 |
| Subtask | Conteúdo completo | — (sem filhos) |

Cards com `label='suggested'` e `workflow_state='draft'` **não podem gerar filhos** até serem ativados.

## Ativação: Draft → Open

Ao ativar um card sugerido:
1. `workflow_state` muda de `'draft'` para `'open'`
2. Label `'suggested'` é removido
3. Card se torna item pleno do backlog
4. Geração de filhos é desbloqueada

## Deleção em Cascata

Deletar um card pai remove **recursivamente** todos os descendentes:
- Epic deletado → Stories + Tasks + Subtasks + comentários + transições de status
- Task deletada → Subtasks + entrevistas vinculadas
- Subtask/Bug deletados → comentários e transições

## Tipos de Reporter

| Valor | Quando usar |
|-------|-------------|
| `system` | Padrão quando não informado |
| `ai` | Gerado automaticamente por IA |
| `watchdog` | Gerado pelo monitoramento background |

`assignee` é nullable em todos os tipos — cards sem responsável são válidos.
"""
    },
    {
        "slug": "workflow-states",
        "title": "Máquinas de Estado por Tipo de Item",
        "order_index": 36,
        "content": """# Máquinas de Estado por Tipo de Item

## Visão Geral

Cada tipo de item no ORBIT possui sua própria máquina de estados, definida em `backend/contracts/business/workflow_states.yaml` e aplicada pelo `WorkflowValidator`. Estados terminais não têm transições de saída.

## Epic: backlog → planning → in_progress → review → done

```
backlog → planning → in_progress → review → done
                ↑__________|
```
- Pode retroceder de `in_progress` para `planning`
- Não pode pular etapas na progressão
- `done` é terminal — sem transições de saída

## Story: backlog → ready → in_progress → review → validation → done

```
backlog → ready → in_progress → review → validation → done
                       ↑_____________|        |
                                              → done (direto)
                                              → in_progress (retrabalho)
```
- Estado intermediário `validation` antes de `done`
- De `review` pode ir para `validation`, `done` ou voltar para `in_progress`

## Task: backlog → todo → in_progress → code_review → testing → done

```
backlog → todo → in_progress → code_review → testing → done
                     ↑______________|
```
- Workflow orientado ao ciclo de desenvolvimento (code review + testing)
- De `code_review` pode ir para `testing`, `done` ou voltar para `in_progress`

## Bug: new → confirmed → in_progress → fixed → verified → closed

```
new → confirmed → in_progress → fixed → verified → closed
                      ↑_____________|
```
- Etapas de confirmação e verificação antes do fechamento
- De `fixed` pode voltar para `in_progress` (reabertura) ou avançar

## Subtask: todo → in_progress → done

```
todo → in_progress → done
  ↑________|
```
- Workflow mais simples do sistema (3 estados)
- Pode voltar de `in_progress` para `todo`

## Bug: Campo severity

Campo exclusivo para Bug (nullable para outros tipos):
- `blocker` — impede completamente o uso
- `critical` — funcionalidade core indisponível
- `major` — funcionalidade importante degradada
- `minor` — inconveniente sem impacto crítico
- `trivial` — cosmético ou muito raro

## Auditoria de Transições

Todas as mudanças de estado são registradas na tabela `StatusTransition` com:
- Actor: `human` | `ai` | `system`
- Timestamp da transição
- Reason (opcional)
- Deletadas em cascata com o card
"""
    },
    {
        "slug": "card-relationships",
        "title": "Relacionamentos entre Cards e Rastreabilidade",
        "order_index": 37,
        "content": """# Relacionamentos entre Cards e Rastreabilidade

## Tipos de Relacionamento

O ORBIT suporta relacionamentos JIRA-style entre cards via modelo `TaskRelationship`:

| Tipo | Semântica | Efeito na Prompt Queue |
|------|-----------|----------------------|
| `blocks` | Este card bloqueia outro | O outro fica BLOCKED |
| `depends_on` | Este card depende de outro | Este fica BLOCKED até o outro completar |
| `relates_to` | Relacionados sem bloqueio | Nenhum |
| `duplicates` | Duplicata semântica de outro | Nenhum (informativo) |
| `clones` | Cópia exata de outro | Nenhum (informativo) |

## depends_on na Prompt Queue

Relacionamentos `depends_on` são **respeitados pela Prompt Queue**:
- Item com dependências não resolvidas permanece com status `BLOCKED`
- A fila não executa o item bloqueado
- Quando todas as dependências atingem `COMPLETED`, o item é desbloqueado automaticamente

## Comentários de Cards

Comentários têm 3 tipos com semântica distinta:

| Tipo | Criado por | Quando |
|------|-----------|--------|
| `comment` | Usuário | Interação manual |
| `system` | Sistema | Eventos automáticos (status change, block, etc.) |
| `ai_generated` | IA | Respostas da IA, sugestões, overages |

Comentários são ordenados por `created_at DESC` e deletados em cascata com o card.

## Rastreabilidade Bidirecional

Cada card mantém campos de rastreabilidade de origem:

```json
{
  "interview_insights": "Texto extraído da resposta Q2 sobre autenticação",
  "interview_question_ids": ["uuid-q1", "uuid-q2"],
  "batch_source": {
    "batch_number": 3,
    "files_processed": 42,
    "layer": "LOGIC"
  }
}
```

**Rastreabilidade de entrevistas:**
- Card → Entrevista: via `interview_question_ids`
- Entrevista → Cards: via `GET /interviews/{id}/cards`
- Deletar Task: deleta entrevistas vinculadas
- Deletar entrevista: **não** deleta os cards gerados

**Batch source:** permite auditoria completa de qual processamento em lote criou cada card — incluindo número do batch, arquivos processados e camada semântica processada.
"""
    },
    {
        "slug": "contexto-projeto",
        "title": "Contexto do Projeto e Ciclo de Vida",
        "order_index": 38,
        "content": """# Contexto do Projeto e Ciclo de Vida

## Estados do Projeto

O projeto segue uma máquina de estados forward-only:

```
draft → processing → active
```

| Estado | Significado | Pode editar? |
|--------|------------|--------------|
| `draft` | Criado, pipeline não iniciado | ✅ Sim |
| `processing` | Pipeline rodando | ❌ Bloqueado |
| `active` | Pipeline concluído, pronto para uso | ✅ Sim |

**Sem retroação:** um projeto `active` não pode voltar para `processing` ou `draft`.

## Wizard de Criação

O projeto só é criado se o wizard de configuração for **concluído integralmente**. Se o usuário abandonar o wizard (fechar aba, navegar, refresh), um job de background detecta o projeto `draft` orphaned e o deleta automaticamente após timeout.

## Travamento de Contexto (context_locked)

O contexto do projeto (`context_semantic` + `context_human`) é travado permanentemente quando o primeiro Epic é ativado:

1. Usuário ativa o primeiro Epic
2. Sistema seta `context_locked = true`
3. Campos `context_semantic` e `context_human` ficam **imutáveis para sempre**
4. Projeto muda de `draft/processing` para `active`

### Regras do context_locked

- Só pode mudar `false → true`, nunca o inverso
- Com `context_locked = true`, qualquer tentativa de atualizar o contexto retorna HTTP 409
- Nova entrevista de contexto é bloqueada e o usuário é redirecionado
- Entrevistas `task_focused` ainda são permitidas (não alteram o contexto do projeto)

## Proteção contra Deleção

O campo `protected = true` impede deleção acidental do projeto:
- API retorna HTTP 403 ao tentar deletar projeto protegido
- Para deletar, o usuário deve primeiro remover a proteção explicitamente via PATCH
- Não existe bypass direto

## Campos de Contexto

| Campo | Tipo | Conteúdo |
|-------|------|----------|
| `context_semantic` | JSON | Mapa arquitetural: domínios, dependências, padrões, tech stack |
| `context_human` | Text | Resumo legível do projeto para humanos |
| `context_locked` | Boolean | Se verdadeiro, ambos os campos são imutáveis |
| `code_path` | String | Caminho da pasta de código — obrigatório, imutável após criação |
"""
    },
]

import os

def step3_create_wiki(cur):
    print("\n=== STEP 3: Create new wiki pages ===")

    cur.execute("SELECT slug FROM wiki_pages WHERE project_id = %s", (PROJECT_ID,))
    existing_slugs = {r[0] for r in cur.fetchall()}

    created = 0
    for page in NEW_WIKI_PAGES:
        slug = page["slug"]
        if slug in existing_slugs:
            print(f"  SKIP (exists): {slug}")
            continue

        page_id = str(uuid.uuid5(uuid.UUID(PROJECT_ID), slug))
        title = page["title"]
        order_index = page["order_index"]
        raw_content = page["content"]

        file_content = f"""---
title: "{title}"
slug: "{slug}"
source: "generated"
order_index: {order_index}
created_at: "{NOW}"
updated_at: "{NOW}"
---

{raw_content}
"""
        os.makedirs(WIKI_DIR, exist_ok=True)
        with open(os.path.join(WIKI_DIR, f"{slug}.md"), "w", encoding="utf-8") as f:
            f.write(file_content)

        cur.execute("""
            INSERT INTO wiki_pages (id, project_id, title, slug, content, source, order_index, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, 'generated', %s, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """, (page_id, PROJECT_ID, title, slug, raw_content, order_index))

        rag_content = f"WIKI PAGE: {title}\nSlug: {slug}\n\n{raw_content}"
        rag_meta = json.dumps({"type": "wiki_page", "title": title, "slug": slug,
                               "source": "generated", "order_index": order_index})
        cur.execute("""
            INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at)
            VALUES (%s, %s, %s, %s::vector, %s::jsonb, NOW())
        """, (str(uuid.uuid4()), PROJECT_ID, rag_content, embed_str(rag_content), rag_meta))

        created += 1
        print(f"  CREATED: {slug} — {title}")

    print(f"  Total new wiki pages: {created}")


# ============================================================
# STEP 4: Update wiki pages that already exist but need new-rule references
# ============================================================
WIKI_ENRICHMENTS = {
    "geracao-backlog": "\n\n## Subtask (Nível Operacional)\n\nTask → 3-5 Subtasks ao ativar. Subtask é folha — sem filhos. Workflow: todo→in_progress→done. Gerada com Semantic Reference Methodology completa.\n\nSee also: [hierarquia-cards](/wiki/hierarquia-cards), [workflow-states](/wiki/workflow-states)",
    "sistema-jobs": "\n\n## Watchdog — Limites por Ciclo\n\n- Máx 10 cards gerados/ciclo (PROMPT #228)\n- Máx 2 cards enriquecidos/ciclo idle\n- Limites via contrato: `backend/contracts/business/watchdog_limits.yaml`",
    "kanban-board": "\n\n## Relacionamentos entre Cards\n\nSuporte a relacionamentos JIRA-style: `blocks`, `depends_on`, `relates_to`, `duplicates`, `clones`.\n`depends_on` bloqueia item na Prompt Queue até dependências completadas.\nVer: [card-relationships](/wiki/card-relationships)",
}

def step4_enrich_existing_wiki(cur):
    print("\n=== STEP 4: Enrich existing wiki pages ===")
    enriched = 0
    for slug, addition in WIKI_ENRICHMENTS.items():
        cur.execute("""
            SELECT id, content FROM wiki_pages
            WHERE project_id = %s AND slug = %s
        """, (PROJECT_ID, slug))
        row = cur.fetchone()
        if not row:
            print(f"  SKIP (not found): {slug}")
            continue

        page_id, content = row
        if addition.strip()[:30] in content:
            print(f"  SKIP (already enriched): {slug}")
            continue

        new_content = content + addition
        cur.execute("""
            UPDATE wiki_pages SET content = %s, updated_at = NOW() WHERE id = %s
        """, (new_content, page_id))

        # Update RAG doc
        rag_content = f"WIKI PAGE: {slug}\n\n{new_content}"
        cur.execute("""
            UPDATE rag_documents SET content = %s, embedding = %s::vector
            WHERE project_id = %s AND metadata->>'type' = 'wiki_page'
              AND metadata->>'slug' = %s
        """, (rag_content, embed_str(rag_content), PROJECT_ID, slug))

        enriched += 1
        print(f"  ENRICHED: {slug}")

    print(f"  Total enriched: {enriched}")


# ============================================================
# STEP 5: Final verification
# ============================================================
def step5_verify(cur):
    print("\n" + "="*60)
    print("FINAL VERIFICATION")
    print("="*60)

    cur.execute("SELECT COUNT(*) FROM tasks WHERE project_id = %s", (PROJECT_ID,))
    print(f"  Total cards: {cur.fetchone()[0]}")

    cur.execute("SELECT COUNT(*) FROM wiki_pages WHERE project_id = %s", (PROJECT_ID,))
    print(f"  Total wiki pages: {cur.fetchone()[0]}")

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'business_rule'", (PROJECT_ID,))
    print(f"  Business rules: {cur.fetchone()[0]}")

    cur.execute("SELECT COUNT(*) FROM rag_documents WHERE project_id = %s", (PROJECT_ID,))
    print(f"  Total RAG docs: {cur.fetchone()[0]}")

    cur.execute("""
        SELECT item_type, COUNT(*) FROM tasks WHERE project_id = %s GROUP BY item_type ORDER BY item_type
    """, (PROJECT_ID,))
    print("\n  Cards by type:")
    for row in cur.fetchall():
        print(f"    {row[0]}: {row[1]}")

    cur.execute("""
        SELECT metadata->>'source_domain', COUNT(*)
        FROM rag_documents WHERE project_id = %s AND metadata->>'type' = 'business_rule'
        GROUP BY metadata->>'source_domain' ORDER BY count DESC
    """, (PROJECT_ID,))
    print("\n  Business rules by domain:")
    total = 0
    for row in cur.fetchall():
        print(f"    {row[0]}: {row[1]}")
        total += row[1]
    print(f"    TOTAL: {total}")

    cur.execute("""
        SELECT COUNT(*) FROM tasks WHERE project_id = %s
          AND generation_context::text LIKE '%%acceptance_criteria%%'
    """, (PROJECT_ID,))
    ac = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM tasks WHERE project_id = %s", (PROJECT_ID,))
    total_cards = cur.fetchone()[0]
    print(f"\n  Cards with AC: {ac}/{total_cards}")

    cur.execute("""
        SELECT COUNT(*) FROM tasks WHERE project_id = %s AND item_type = 'epic'
          AND generation_context::text LIKE '%%related_rules%%'
    """, (PROJECT_ID,))
    print(f"  Epics with rule links: {cur.fetchone()[0]}/14")


# ============================================================
# MAIN
# ============================================================
def main():
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    step1_update_epic_rule_links(cur)
    conn.commit()

    step2_create_cards(cur)
    conn.commit()

    step3_create_wiki(cur)
    conn.commit()

    step4_enrich_existing_wiki(cur)
    conn.commit()

    step5_verify(cur)

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
