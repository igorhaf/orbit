# PROMPT #280 - Titulo em Portugues + Botao Gerar Epicos no Backlog Vazio
## Fix titulo do projeto gerado em ingles e adicao de botao Gerar Epicos

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / UI Enhancement
**Impact:** Titulo do projeto agora e gerado em portugues e backlog vazio tem botao para gerar epicos

---

## Objective

Corrigir 2 problemas reportados:

1. **Titulo do projeto em ingles**: O titulo (project.name) era gerado em ingles ("Course Management System with User Authentication and Reviews") enquanto a descricao (context_human) era em portugues - informacao duplicada em idiomas diferentes
2. **Botao Gerar Epicos ausente**: No backlog vazio, so havia "Add Epic" (manual). Faltava botao para gerar epicos automaticamente via IA

---

## What Was Implemented

### 1. Reforco de Portugues nos Contracts de Memoria

**Causa raiz:** Os contracts YAML de `memory/codebase_analysis` e `memory/consolidation` nao tinham instrucao forte de portugues no final. Modelos locais (Qwen3/Gemma3) ao analisar codigo em ingles geravam titulo em ingles.

**Correcao:** Adicionada instrucao "IDIOMA OBRIGATORIO" no final de `system_prompt` e `user_prompt` de:
- `backend/app/contracts/memory/codebase_analysis.yaml` - system_prompt e user_prompt
- `backend/app/contracts/memory/consolidation.yaml` - system_prompt e user_prompt

**Tambem corrigido:** Prompt hardcoded em `backend/app/services/codebase_memory.py` na funcao `_chain_consolidate_insights()` que fazia consolidacao para modelos locais sem instrucao de portugues.

### 2. Botao Gerar Epicos no Backlog Vazio

**Arquivo:** `frontend/src/components/backlog/BacklogListView.tsx`

No estado vazio (backlog.length === 0), adicionado botao "Gerar Epicos" ao lado de "Adicionar Epico". O botao so aparece quando `onGenerateEpics` callback e passado (ou seja, quando o projeto tem `initial_memory_context`).

### 3. Traducao de UI para Portugues

Traduzidos textos em ingles para portugues:
- BacklogListView: "No backlog items" -> "Nenhum item no backlog"
- BacklogListView: "Add Epic" -> "Adicionar Epico"
- BacklogListView: "Generate Epics" -> "Gerar Epicos"
- Dialog: "Generate Epics" -> "Gerar Epicos"
- Dialog: "Number of Epics" -> "Quantidade de Epicos"
- Dialog: "Cancel" -> "Cancelar" / "Generate" -> "Gerar"
- Watchdog banner: "continuously discovering..." -> "descobrindo e atualizando..."
- Mensagens de sucesso/erro traduzidas

---

## Files Modified

### Backend:
1. **`backend/app/contracts/memory/codebase_analysis.yaml`** - Instrucao de portugues em system_prompt e user_prompt
2. **`backend/app/contracts/memory/consolidation.yaml`** - Instrucao de portugues em system_prompt e user_prompt
3. **`backend/app/services/codebase_memory.py`** - Instrucao de portugues no prompt hardcoded de chain consolidation

### Frontend:
4. **`frontend/src/components/backlog/BacklogListView.tsx`** - Botao Gerar Epicos no estado vazio + traducao
5. **`frontend/src/app/projects/[id]/page.tsx`** - Dialog traduzido + watchdog banner traduzido

---

## Testing Results

```
OK  Python syntax: codebase_memory.py
OK  Contract codebase_analysis.yaml: instrucao de portugues em system_prompt e user_prompt
OK  Contract consolidation.yaml: instrucao de portugues em system_prompt e user_prompt
OK  Backlog vazio: botao "Gerar Epicos" visivel quando onGenerateEpics disponivel
OK  Backlog com itens: botao "Gerar Epicos" traduzido
OK  Dialog: traduzido para portugues
```

---

## Key Insights

### 1. Cadeia de geracao de titulo
O titulo do projeto passa por: `codebase_analysis.yaml` (partial_title) -> `consolidation.yaml` (suggested_title) -> `project.name`. Se qualquer elo da cadeia gera em ingles, o titulo final fica em ingles.

### 2. Chain prompting hardcoded
Alem dos contracts YAML, havia um prompt hardcoded em `_chain_consolidate_insights()` que era usado para modelos locais (Ollama). Este prompt tambem precisava de instrucao de portugues.

### 3. Duplicacao de informacao
O titulo (project.name) e a descricao (context_human) contem a mesma informacao em formatos diferentes. Garantir que ambos estejam no mesmo idioma e critico para a experiencia do usuario.

---

## Status: COMPLETE

**Key Achievements:**
- Instrucao de portugues adicionada em 3 locais de geracao de titulo
- Botao "Gerar Epicos" adicionado ao backlog vazio
- UI traduzida para portugues (backlog, dialog, watchdog banner)
