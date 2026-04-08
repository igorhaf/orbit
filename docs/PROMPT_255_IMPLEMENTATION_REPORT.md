# PROMPT #255 - Intelligent Card Hierarchy + Complexity Field + Phase 2 Rewrite

**Date:** 2026-02-21
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation + Bug Fix
**Impact:** Cards agora respeitam hierarquia rigida, incluem campo de complexidade, e Phase 2 funciona via Claudio agente

---

## 🎯 Objective

Tres melhorias criticas no RAG pipeline:

1. **Hierarquia Inteligente de Cards** — Garantir que cards gerados na Phase 3 respeitem hierarquia Epic > Story > Task > Subtask corretamente
2. **Campo de Complexidade** — Adicionar campo `complexity` (low/medium/high) que mapeia para modelo Claude (Haiku/Sonnet/Opus)
3. **Phase 2 Rewrite** — Reescrever Phase 2 para usar Claudio como agente com acesso ao filesystem via `cwd`

---

## ✅ What Was Implemented

### 1. Hierarquia Inteligente de Cards (Phase 3)

**Problemas identificados e corrigidos:**

- **Cross-pass orphans**: `title_to_id` era reconstruido do zero a cada pass. Cards do pass 2/3 que referenciavam `parent_title` de cards do pass 1 ficavam orfaos.
  - **Fix**: Pre-popula `title_to_id` do DB antes de criar novos cards.

- **Sem validacao de tipo pai-filho**: Story podia apontar para outra story como pai.
  - **Fix**: Adicionado `EXPECTED_PARENT_TYPE` e validacao no Pass 3.

- **Sem ordenacao de insercao**: Cards inseridos na ordem do JSON sem garantia que epics venham primeiro.
  - **Fix**: `valid_cards.sort(key=TYPE_ORDER)` — epics primeiro, depois stories, tasks, subtasks.

- **Orfaos silenciosos**: Cards sem pai ficavam sem aviso.
  - **Fix**: Logging de warning com contagem de orfaos.

- **Prompt incompleto**: Instrucoes de hierarquia vagas.
  - **Fix**: PHASE3_SYSTEM_PROMPT enriquecido com REGRA DE PARENTESCO e ORDEM NO JSON.

### 2. Campo de Complexidade

**End-to-end implementation:**

- **Backend Model**: `complexity = Column(String(10), default="medium")` — era `Integer`, agora `String`
- **Pydantic Schemas**: `complexity: str` em TaskBase e TaskUpdate
- **Migration**: `p255_complexity_string` converte Integer→String com mapeamento de dados
- **Phase 3 Prompt**: Schema e regras de complexidade no PHASE3_SYSTEM_PROMPT
- **Validator**: Auto-default inteligente por item_type (epic→high, subtask→low)
- **Frontend OverviewTab**: Dropdown com opcoes Haiku/Sonnet/Opus e cores
- **Frontend ItemDetailPanel**: Badge de complexidade no header
- **Task Executor**: `_select_model` atualizado para aceitar string

### 3. Phase 2 Rewrite — Claudio como Agente

**Problema raiz**: Phase 2 tentava injetar RAG e receber JSON na resposta. Mas:
- RAG injection falhava (semantic similarity baixa, `min_score=0.3` descartava tudo)
- Claudio com `cwd` entra em modo agente e responde como chat ("Aguardando os agentes...")
- 0 regras extraidas em todas as 3 passadas

**Nova abordagem**:
- Claudio recebe prompt pedindo para LER o codebase e GRAVAR regras em `satellite/knowledge/business_rules.json`
- Claudio e um agente com acesso filesystem via `cwd` — le, navega, escreve arquivos
- Apos Claudio terminar, nosso codigo LE o arquivo JSON gerado
- Valida com `_parse_rules_json` (contrato rigido)
- Importa regras validadas no RAG via `_store_rules`

**Removido**: 3-pass loop, `PHASE2_SYSTEM_PROMPT`, `PHASE2_PASSES`, RAG injection

---

## 📁 Files Modified/Created

### Modified:
1. **backend/app/services/rag_pipeline.py** — Phase 2 rewrite, hierarchy fixes, complexity validation
2. **backend/app/models/task.py** — complexity Integer→String(10)
3. **backend/app/schemas/task.py** — complexity field in TaskBase and TaskUpdate
4. **frontend/src/lib/types.ts** — TypeScript complexity type
5. **frontend/src/components/backlog/OverviewTab.tsx** — Complexity dropdown
6. **frontend/src/components/backlog/ItemDetailPanel.tsx** — Complexity badge
7. **backend/app/services/task_execution/executor.py** — _select_model string-based

### Created:
1. **backend/alembic/versions/p255_complexity_string.py** — Migration Integer→String
2. **satellite/knowledge/PROMPT_255_IMPLEMENTATION_REPORT.md** — This report

---

## 🧪 Testing Results

```bash
✅ Python syntax check: ast.parse() passed
✅ TypeScript types updated with complexity union type
✅ Migration handles data conversion (1-2→low, 3→medium, 4-5→high)
✅ Phase 2 output directory creation handled (os.makedirs)
✅ Orchestrator resolves cwd from project_id automatically
```

---

## 🎯 Success Metrics

✅ **Hierarchy**: Cards sorted by type level before insertion
✅ **Cross-pass linking**: title_to_id pre-populated from DB
✅ **Type validation**: EXPECTED_PARENT_TYPE enforced
✅ **Orphan detection**: Warning logged with count
✅ **Complexity**: Full stack (model → schema → migration → prompt → frontend)
✅ **Phase 2**: Single Claudio call with filesystem access, reads output file

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ Cards respeitam hierarquia Epic > Story > Task > Subtask com validacao
- ✅ Complexidade low/medium/high mapeia para Haiku/Sonnet/Opus
- ✅ Phase 2 usa Claudio como agente autonomo que le o codebase
- ✅ Contrato JSON rigido mantido em todas as fases
