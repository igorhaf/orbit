# PROMPT #271 - Hierarquia de Cards com Gradiente de Conteudo
## Watchdog gera Epics por dominio com Stories filhas e gradiente de conteudo

**Date:** 2026-02-13
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Cards auto-descobertos passam de Stories orfas para hierarquia Epic > Story com conteudo graduado por nivel

---

## Objective

O usuario reportou que o watchdog (`_auto_discover_cards`) criava Stories orfas diretamente a partir de regras de negocio do RAG, sem Epic pai e sem respeitar a hierarquia. Alem disso, queria um gradiente de conteudo por nivel:

- **Epic**: regras de negocio (dominio/modulo) - visao macro, stakeholder nao-tecnico
- **Story**: regras de negocio contextuais (como a regra se aplica ao usuario)
- **Task**: balanceado entre funcional e tecnico
- **Subtask**: objetivamente tecnico (nomes de arquivos, funcoes, testes)

**Key Requirements:**
1. Regras novas do RAG geram cards hierarquicos (Epic primeiro, Stories como filhas)
2. Gradiente de conteudo por nivel da hierarquia
3. Deduplicacao: nao criar Epics duplicados para o mesmo dominio
4. Classificacao de regras por dominio de negocio

---

## What Was Implemented

### 1. Novo Prompt YAML: epic_from_rules.yaml

**Criado:** `backend/app/prompts/backlog/epic_from_rules.yaml`

Prompt para gerar Epics a partir de regras de negocio agrupadas por dominio. Inclui:
- Componente `semantic_methodology` para consistencia com hierarquia existente
- Variaveis: `domain_name`, `rules_text`, `rule_count`, `project_name`, `project_context`
- Saida JSON com titulo, mapa semantico, descricao em markdown, criterios de aceitacao
- Gradiente de conteudo: "O Epic e o nivel MAIS ALTO e deve focar exclusivamente em REGRAS DE NEGOCIO"

### 2. Refatoracao do _auto_discover_cards (watchdog.py)

**Problema:** Criava `Task(item_type=ItemType.STORY, parent_id=None)` - Stories orfas.

**Novo fluxo:**
1. Busca regras recentes do RAG com `source_file` para classificacao
2. Deduplica contra cards existentes (similarity 0.90)
3. Classifica regras por dominio usando `_classify_rule_domain()`
4. Para cada dominio com regras novas:
   a. Busca Epic existente (label `domain-epic` + titulo similar)
   b. Se nao existe: gera Epic com AI (prompt `epic_from_rules.yaml`)
   c. Para cada regra: cria Story como filha do Epic (`parent_id=epic.id`)

**Funcoes novas:**
- `_classify_rule_domain(source_file)` - 44 fragmentos de path para 20 dominios de negocio
- `_find_existing_domain_epic(db, project_id, domain_name)` - busca Epic existente por label + titulo
- `_create_domain_epic_with_ai(db, project_id, domain_name, domain_rules)` - gera Epic via AI com fallback simples
- `_create_story_from_rule(db, project_id, epic_id, rule_content, domain_name, source_file)` - cria Story com parent_id

### 3. Gradiente de Conteudo nos Prompts YAML

Adicionado bloco **GRADIENTE DE CONTEUDO** em cada prompt da hierarquia:

**epic_from_rules.yaml** (Nivel Epic):
- "Focar exclusivamente em REGRAS DE NEGOCIO"
- "Conteudo compreensivel por stakeholder NAO-tecnico"
- "O QUE o sistema faz, POR QUE faz, QUAIS restricoes existem"

**stories_from_epic.yaml** (Nivel Story):
- "Regras de negocio CONTEXTUAIS"
- "COMO a regra se aplica ao usuario, QUAIS restricoes impoe, QUAIS fluxos governa"
- "Evite detalhes tecnicos - isso e para Task/Subtask"

**tasks_from_story.yaml** (Nivel Task):
- "EQUILIBRIO entre funcional e tecnico"
- "Descreva O QUE precisa ser construido + indique COMO em linhas gerais"
- "NAO seja puramente tecnico nem puramente funcional"

**subtasks_from_task.yaml** (Nivel Subtask):
- "Nivel mais TECNICO - o mais proximo do codigo"
- "Nomes REAIS de arquivos, funcoes, classes, modulos"
- "DIRETAMENTE acionavel por um desenvolvedor"
- "Instrucoes que um dev junior pode seguir"

---

## Files Modified/Created

### Created:
1. **backend/app/prompts/backlog/epic_from_rules.yaml** - Novo prompt para Epics de dominio
2. **PROMPT_271_IMPLEMENTATION_REPORT.md** - Este report

### Modified:
1. **backend/app/services/watchdog.py** - Refatoracao completa de `_auto_discover_cards` + 4 funcoes novas
2. **backend/app/prompts/backlog/stories_from_epic.yaml** - Gradiente de conteudo (nivel Story)
3. **backend/app/prompts/backlog/tasks_from_story.yaml** - Gradiente de conteudo (nivel Task)
4. **backend/app/prompts/backlog/subtasks_from_task.yaml** - Gradiente de conteudo (nivel Subtask)

---

## Testing Results

### Verification:

```
- Syntax check: watchdog.py parsed without errors
- YAML check: All 4 prompts load and parse correctly
  - epic_from_rules: system=2708 chars, user=550 chars
  - stories_from_epic: system=3487 chars, user=1713 chars
  - tasks_from_story: system=3718 chars, user=1742 chars
  - subtasks_from_task: system=2801 chars, user=1024 chars
- Import check: All new functions importable in Docker container
- Domain classification: "Aluno/CertificateController.php" -> Aluno/aluno
- Unknown domain: "unknown/file.py" -> Geral/geral
- PromptLoader: Renders epic_from_rules with semantic_methodology component (4376 chars)
- Backward compatibility: Callers use .get("created", 0) which remains compatible
```

---

## Hierarquia Final

```
Epic: "Gestao de Alunos" [regras de negocio do dominio]
  labels: ["suggested", "auto-discovered", "domain-epic"]
  conteudo: visao macro das regras de negocio do modulo
  |
  +-- Story: "Certificados filtrados por ID do usuario" [regra contextual]
  |   labels: ["suggested", "auto-discovered"]
  |   parent_id: <epic_id>
  |   conteudo: regra de negocio + contexto do dominio + arquivo fonte
  |   |
  |   +-- Task: "Implementar filtro de certificados" [funcional + tecnico]
  |   |   (gerado na ativacao da Story via PROMPT #102)
  |   |   |
  |   |   +-- Subtask: "Criar query SQL com WHERE user_id" [tecnico puro]
  |   |       (gerado na ativacao da Task via PROMPT #102)
  |
  +-- Story: "Data de emissao em ordem decrescente" [regra contextual]
  ...

Epic: "Gestao de Cursos" [outro dominio]
  +-- Story: "Instrutores podem criar cursos..."
  ...
```

---

## Key Insights

### 1. Hierarquia e fundamental para organizacao de backlog
O watchdog original criava Stories sem contexto de dominio, dificultando a organizacao. Agrupar por dominio via Epic cria uma estrutura navegavel que reflete a arquitetura de negocio do projeto.

### 2. Gradiente de conteudo guia a AI em cada nivel
Sem instrucao explicita, a AI tende a gerar conteudo tecnico em todos os niveis. O bloco GRADIENTE DE CONTEUDO em cada prompt forca a AI a adaptar o nivel de detalhe tecnico conforme a profundidade na hierarquia.

### 3. Deduplicacao de Epics por dominio e essencial
Sem `_find_existing_domain_epic`, cada ciclo do watchdog criaria Epics duplicados para o mesmo dominio. A busca por label `domain-epic` + titulo similar garante que regras novas do mesmo dominio sejam agrupadas sob o Epic existente.

### 4. Fallback robusto na geracao de Epics
Se a AI falha (timeout, cota excedida, modelo indisponivel), o Epic e criado com titulo e descricao simples. Isso garante que a hierarquia e mantida mesmo sem AI.

---

## Status: COMPLETE

**Key Achievements:**
- Watchdog cria Epics por dominio (com label "domain-epic")
- Stories criadas como filhas de Epics (parent_id preenchido)
- Deduplicacao: nao cria Epics duplicados para o mesmo dominio
- Gradiente de conteudo em 4 niveis da hierarquia
- Backward-compatible com callers existentes

**Impact:**
- Fim das Stories orfas (parent_id=None)
- Backlog organizado por dominios de negocio
- Conteudo adaptado por nivel: negocio (Epic/Story) -> tecnico (Task/Subtask)
- Hierarquia completa: Epic > Story > Task > Subtask
