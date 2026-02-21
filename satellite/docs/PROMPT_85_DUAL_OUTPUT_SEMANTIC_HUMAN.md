# PROMPT #85 - Dual Output: Semantic Prompt + Human Description
## Separação de texto semântico (prompt de saída) e texto humano (descrição legível)

**Date:** January 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Melhoria significativa na usabilidade dos cards - descrição legível para humanos, prompt semântico para geração de cards filhos

---

## Objetivo

Separar o output da geração de cards em dois campos distintos:

1. **`description`** (Aba Descrição): Texto humano natural, legível, derivado do texto semântico
2. **`generated_prompt`** (Aba Prompt): Texto semântico estruturado (N1, P1, E1, etc.) - usado como prompt de saída para gerar cards filhos

**Motivação do usuário:**
> "essa descrição definitivamente ficou maravilhosa, mas como nosso prompt de saida, que vai estar na aba prompt do card, na aba descrição, coloque um texto humano, use o texto semantico para montar o texto humano, não precisamos de mais IA nisso, o texto semantico será nosso prompt de saida"

---

## Implementação

### 1. Função de Conversão Semântico → Humano

**Arquivo:** `backend/app/services/backlog_generator.py`

```python
def _convert_semantic_to_human(semantic_markdown: str, semantic_map: Dict[str, str]) -> str:
    """
    PROMPT #85 - Convert semantic markdown to human-readable text.

    This function transforms semantic references (N1, P1, E1, etc.) into
    their actual meanings, creating natural prose from structured semantic text.
    """
```

**Lógica:**
1. Ordena identificadores por tamanho (maior primeiro) para evitar substituições parciais
2. Substitui cada identificador (N1, P1, E1, etc.) pelo seu significado do semantic_map
3. Remove a seção "## Mapa Semântico" que se torna redundante
4. Limpa artefatos de formatação (asteriscos duplos, bullets vazios, linhas em branco)

### 2. Modificações no BacklogGeneratorService

**Arquivo:** `backend/app/services/backlog_generator.py`

#### Epic Generation (linhas 291-308)
```python
# PROMPT #85 - Dual output: Semantic prompt + Human description
if "description_markdown" in epic_suggestion and "semantic_map" in epic_suggestion:
    # Store semantic markdown as the output prompt (Prompt tab)
    epic_suggestion["generated_prompt"] = epic_suggestion["description_markdown"]

    # Convert semantic to human-readable text (Description tab)
    epic_suggestion["description"] = _convert_semantic_to_human(
        epic_suggestion["description_markdown"],
        epic_suggestion["semantic_map"]
    )
```

#### Story Decomposition (linhas 583-596)
```python
# PROMPT #85 - Dual output: Semantic prompt + Human description
if "description_markdown" in story and "semantic_map" in story:
    story["generated_prompt"] = story["description_markdown"]
    story["description"] = _convert_semantic_to_human(
        story["description_markdown"],
        story["semantic_map"]
    )
```

#### Task Decomposition (linhas 875-888)
```python
# PROMPT #85 - Dual output: Semantic prompt + Human description
if "description_markdown" in task and "semantic_map" in task:
    task["generated_prompt"] = task["description_markdown"]
    task["description"] = _convert_semantic_to_human(
        task["description_markdown"],
        task["semantic_map"]
    )
```

### 3. Rotas de API Atualizadas

**Arquivo:** `backend/app/api/routes/backlog_generation.py`

Todas as rotas de aprovação agora persistem `generated_prompt`:

- **`approve_and_create_epic`** (linha 250): `generated_prompt=suggestion.get("generated_prompt")`
- **`approve_and_create_stories`** (linha 306): `generated_prompt=suggestion.get("generated_prompt")`
- **`approve_and_create_tasks`** (linha 411): `generated_prompt=suggestion.get("generated_prompt")`

---

## Fluxo de Dados

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI Response                                   │
│  {                                                                   │
│    "description_markdown": "# Epic...\n## Mapa Semântico\n- N1:...",│
│    "semantic_map": {"N1": "Usuário", "P1": "Login", ...}            │
│  }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 _convert_semantic_to_human()                         │
│                                                                      │
│  Input: description_markdown + semantic_map                          │
│  Process: Replace N1→"Usuário", P1→"Login", etc.                    │
│  Output: Human-readable text                                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Card Fields                                     │
│                                                                      │
│  description: "Este Epic implementa Login para Usuário..."          │
│               (Aba Descrição - texto humano legível)                 │
│                                                                      │
│  generated_prompt: "# Epic...\n## Mapa Semântico\n- N1: Usuário..." │
│                    (Aba Prompt - texto semântico estruturado)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Arquivos Modificados

### Backend

| Arquivo | Modificação | Linhas |
|---------|-------------|--------|
| `backend/app/services/backlog_generator.py` | Adicionada função `_convert_semantic_to_human()` | 45-95 |
| `backend/app/services/backlog_generator.py` | Epic: dual output | 291-308 |
| `backend/app/services/backlog_generator.py` | Story: dual output | 583-596 |
| `backend/app/services/backlog_generator.py` | Task: dual output | 875-888 |
| `backend/app/api/routes/backlog_generation.py` | Epic: persist generated_prompt | 250 |
| `backend/app/api/routes/backlog_generation.py` | Story: persist generated_prompt | 306 |
| `backend/app/api/routes/backlog_generation.py` | Task: persist generated_prompt | 411 |

---

## Exemplo de Conversão

### Input (Semantic Markdown)
```markdown
# Epic: Sistema de Autenticação

## Mapa Semântico

- **N1**: Usuário do sistema
- **N2**: Administrador
- **P1**: Processo de login
- **E1**: Endpoint /api/auth/login
- **D1**: Tabela users
- **S1**: Serviço de autenticação JWT

## Descrição

Este Epic implementa P1 para N1 e N2, permitindo que N1 acesse o sistema via E1.
O S1 será responsável por validar credenciais armazenadas em D1.

## Critérios de Aceitação

1. **AC1**: N1 consegue realizar P1 com email e senha
2. **AC2**: S1 gera token JWT válido por 24h
```

### Output (Human Description)
```markdown
# Epic: Sistema de Autenticação

## Descrição

Este Epic implementa Processo de login para Usuário do sistema e Administrador,
permitindo que Usuário do sistema acesse o sistema via Endpoint /api/auth/login.
O Serviço de autenticação JWT será responsável por validar credenciais armazenadas
em Tabela users.

## Critérios de Aceitação

1. **Usuário do sistema consegue realizar Processo de login com email e senha**
2. **Serviço de autenticação JWT gera token JWT válido por 24h**
```

---

## Benefícios

1. **Legibilidade**: Descrição em linguagem natural para humanos lerem
2. **Rastreabilidade**: Texto semântico preservado na aba Prompt
3. **Geração de Filhos**: Prompt semântico serve como contexto para gerar Stories/Tasks
4. **Sem IA Adicional**: Conversão é feita via regex, não precisa de chamada à IA
5. **Edição Manual**: Usuário pode editar a descrição livremente sem perder o prompt original

---

## Compatibilidade

- **Backward Compatible**: Cards existentes continuam funcionando
- **Fallback**: Se não houver semantic_map, usa description_markdown em ambos campos
- **Frontend**: Não requer mudanças - já exibe description e generated_prompt separadamente

---

## Status: COMPLETE

**Key Achievements:**
- Função de conversão semântico → humano implementada
- Dual output para Epic, Story e Task
- Rotas de API atualizadas para persistir generated_prompt
- Documentação completa

**Impact:**
- UX melhorada: descrições legíveis para humanos
- Workflow otimizado: prompt semântico preservado para geração de hierarquia
- Zero overhead de IA: conversão feita localmente

---

**PROMPT #85 - Completed**

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
