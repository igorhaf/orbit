# PROMPT #281 - Sync Project Name from Wiki Enrichment + Generate Epics Button
## Fix titulo duplicado em idiomas diferentes + botao Generate Epics no backlog vazio

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / UI Enhancement
**Impact:** Titulo do projeto agora sincroniza com a wiki (elimina duplicacao ingles/portugues) e backlog vazio tem botao Generate Epics

---

## Objective

Corrigir 2 problemas:

1. **Titulo duplicado em idiomas diferentes**: `project.name` era "Course Management System with User Authentication and Reviews" (ingles, do memory scan) enquanto `project.description` comecava com "Sistema de Gestao de Cursos com Autenticacao e Avaliacoes" (portugues, do wiki enrichment). Mesma informacao gerada duas vezes por pipelines diferentes.

2. **Botao Generate Epics ausente no backlog vazio**: Quando o backlog esta vazio, so havia "Add Epic" (manual). Faltava botao para gerar epicos via IA.

---

## Root Cause Analysis

### Duas pipelines gerando a mesma informacao:

**Pipeline 1 - Memory Scan** (durante criacao do projeto):
- `codebase_memory.py` → `contracts/memory/consolidation.yaml` → `suggested_title`
- Resultado: `project.name = suggested_title` (pode ser ingles se modelo nao respeitar instrucao)

**Pipeline 2 - Wiki Enrichment** (logo apos memory scan):
- `prompts/context/wiki_enrichment.yaml` → markdown estruturado com `# Titulo do Projeto`
- Resultado: `project.description = enriched` (portugues, pois prompt tem instrucao forte)

O titulo na descricao (Pipeline 2) era correto em portugues, mas o `project.name` (Pipeline 1) ficava em ingles. O usuario via os dois no header da pagina do projeto.

---

## What Was Implemented

### 1. Sync project.name from wiki enrichment

**Arquivo:** `backend/app/api/routes/projects.py` (funcao `_enrich_context_from_rag`)

Apos o wiki enrichment gerar a descricao estruturada, extrair o titulo `# ...` da primeira linha e atualizar `project.name`:

```python
first_line = enriched.strip().split("\n")[0].strip()
if first_line.startswith("# "):
    wiki_title = first_line[2:].strip()
    if wiki_title and len(wiki_title) > 3:
        project.name = wiki_title
```

Isso garante que `project.name` e `project.description` estejam sempre sincronizados - o titulo vem da mesma fonte que a descricao.

### 2. Generate Epics button no backlog vazio

**Arquivo:** `frontend/src/components/backlog/BacklogListView.tsx`

Adicionado botao "Generate Epics" ao lado de "Add Epic" no estado vazio. O botao aparece quando `onGenerateEpics` callback esta disponivel (projeto tem `initial_memory_context`).

### 3. Revert UI translations

Revertido todas as traducoes de UI para ingles (a interface deve ser em ingles). Afetou:
- BacklogListView.tsx
- projects/[id]/page.tsx (epic dialog, watchdog banner)
- projects/page.tsx (delete dialog)

---

## Files Modified

### Backend:
1. **`backend/app/api/routes/projects.py`** - Sync project.name from wiki enrichment title
2. **`backend/app/contracts/memory/codebase_analysis.yaml`** - Portuguese enforcement (commit anterior)
3. **`backend/app/contracts/memory/consolidation.yaml`** - Portuguese enforcement (commit anterior)
4. **`backend/app/services/codebase_memory.py`** - Portuguese enforcement in chain prompting (commit anterior)

### Frontend:
5. **`frontend/src/components/backlog/BacklogListView.tsx`** - Generate Epics button in empty state + reverted PT translations
6. **`frontend/src/app/projects/[id]/page.tsx`** - Reverted PT translations (dialog, banner)
7. **`frontend/src/app/projects/page.tsx`** - Reverted PT translations (delete dialog)

---

## Testing Results

```
OK  Python syntax: projects.py
OK  Wiki enrichment: extrai titulo da primeira linha "# Titulo"
OK  project.name atualizado quando wiki enrichment gera descricao
OK  Backlog vazio: botao Generate Epics visivel quando onGenerateEpics disponivel
OK  UI em ingles: todas traducoes revertidas
```

---

## Key Insights

### 1. Duas pipelines, mesma informacao
O memory scan e o wiki enrichment processam o mesmo codebase e geram informacao semanticamente identica. A diferenca e que o memory scan gera um titulo curto e o wiki enrichment gera um documento estruturado completo. Sincronizar o titulo da wiki para o project.name elimina a duplicacao.

### 2. Interface em ingles, conteudo em portugues
A interface (UI) do ORBIT e em ingles. O conteudo gerado pela IA (descricoes, regras, features) e em portugues. Sao camadas diferentes - nao devem ser misturadas.

---

## Status: COMPLETE

**Key Achievements:**
- Titulo do projeto sincronizado com wiki enrichment (elimina mismatch ingles/portugues)
- Botao Generate Epics adicionado ao backlog vazio
- UI revertida para ingles conforme preferencia do usuario
