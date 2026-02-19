# PROMPT #241 - Orbit Folder Architecture (Phase A)
## Pasta orbit/ como bridge entre cards e Claude Code

**Date:** February 19, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Cards podem exportar prompts como .md para execucao manual no Claude Code

---

## 🎯 Objective

Criar a infraestrutura da pasta `orbit/` dentro do `code_path` de cada projeto. Esta pasta serve como ponte entre o sistema de cards do ORBIT e a execucao de prompts no Claude Code.

**Key Requirements:**
1. Estrutura de pastas: `orbit/prompts/`, `orbit/results/`, `orbit/knowledge/`
2. Exportacao de prompts dos cards como arquivos .md estruturados
3. Convencao de nomes: `{ITEM_TYPE}_{short_id}_{title_slug}.md`
4. Front matter YAML com metadados do card para rastreabilidade
5. Exclusao da pasta `orbit/` do RAG scanning

---

## ✅ What Was Implemented

### 1. OrbitFolderService (backend/app/services/orbit_folder.py)
- `ensure_orbit_structure(project)` — cria pasta orbit/ e subpastas
- `export_prompt(task)` — renderiza MD com front matter e salva
- `get_orbit_status(project)` — conta arquivos em cada subpasta
- `_build_orbit_filename(task)` — nome deterministico do arquivo
- `_slugify(text)` — converte titulo para slug seguro
- `_render_prompt_md(task, project)` — renderiza conteudo completo

### 2. Endpoints (backend/app/api/routes/tasks_old.py)
- `POST /tasks/{task_id}/export-prompt` — exporta prompt do card
- `GET /tasks/project/{project_id}/orbit-status` — status da pasta

### 3. IGNORE_DIRECTORIES (backend/app/services/codebase_memory.py)
- Adicionado `"orbit"` ao set para evitar indexacao RAG

### 4. Frontend API (frontend/src/lib/api.ts)
- `tasksApi.exportPrompt(taskId)` — chama endpoint de export
- `tasksApi.getOrbitStatus(projectId)` — consulta status

### 5. Botao "Exportar" (frontend/src/components/backlog/ItemDetailPanel.tsx)
- Botao verde ao lado de "Copiar" na tab Prompt
- Feedback visual com caminho do arquivo exportado
- Loading state durante exportacao

### 6. Icone (frontend/src/components/icons/index.tsx)
- `IconExport` — icone SVG de exportacao

---

## 📁 Files Modified/Created

### Created:
1. **backend/app/services/orbit_folder.py** — OrbitFolderService completo

### Modified:
1. **backend/app/api/routes/tasks_old.py** — 2 endpoints adicionados
2. **backend/app/services/codebase_memory.py** — orbit em IGNORE_DIRECTORIES
3. **frontend/src/lib/api.ts** — 2 metodos no tasksApi
4. **frontend/src/components/backlog/ItemDetailPanel.tsx** — botao + estado + handler
5. **frontend/src/components/icons/index.tsx** — IconExport

---

## 🧪 Testing Results

```
✅ Frontend build passed (npx next build)
✅ IconExport criado e importado corretamente
✅ Botao Exportar renderiza na tab Prompt
```

---

## 🎯 Formato do Arquivo Exportado

```markdown
---
orbit_card_id: <uuid>
orbit_item_type: TASK
orbit_project_id: <uuid>
orbit_project_name: Suinda
orbit_short_id: a3f2
orbit_title: Implementar Autenticacao JWT
orbit_priority: high
orbit_story_points: 5
orbit_parent_id: <uuid>
orbit_exported_at: 2026-02-19T10:30:00Z
orbit_schema_version: "1"
---

# TASK: Implementar Autenticacao JWT

## Contexto do Projeto
{contexto}

## Descricao
{descricao}

## Mapa Semantico
{identificadores}

## Criterios de Aceitacao
{checklists}

## Prompt de Execucao
{generated_prompt}
```

---

## 🎉 Status: COMPLETE (Phase A)

**Key Achievements:**
- ✅ Pasta orbit/ criada automaticamente ao exportar
- ✅ Prompts exportados com front matter YAML rastreavel
- ✅ Convencao de nomes deterministica (mesmo card = mesmo arquivo)
- ✅ RAG scanner ignora pasta orbit/
- ✅ Frontend build OK

**Fases Futuras:**
- **Fase B:** Deteccao de resultado (watchdog + botao manual)
- **Fase C:** Upload de conhecimento para orbit/knowledge/
- **Fase D:** Loop de avaliacao IA (auto-fix cycle)

---
