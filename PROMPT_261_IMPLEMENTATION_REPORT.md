# PROMPT #261 - Multi-page Wiki System + Contract Language Fix
## Wiki com paginas separadas e correcao de contratos misturando ingles/portugues

**Date:** February 13, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation + Bug Fix
**Impact:** Projeto agora tem wiki real com paginas separadas e navegacao; contratos geram texto 100% em portugues

---

## Objective

1. **Wiki Real**: Substituir a abordagem de "uma pagina com um monte de markdown" por um sistema wiki completo com paginas separadas, links entre paginas, sidebar de navegacao e geracao automatica a partir do contexto do projeto.

2. **Contratos em Portugues**: Corrigir todos os contratos YAML que geravam texto misturando ingles com portugues, traduzindo 100% para portugues.

---

## What Was Implemented

### 1. Multi-page Wiki System

**Backend:**
- Modelo `WikiPage` com suporte a hierarquia (parent/child), slugs para URLs, multiple sources (manual/ai_generated/enrichment)
- API CRUD completa: list, tree, get by slug, create, update, delete
- Endpoint `POST /generate-from-context` que cria paginas a partir dos dados do projeto (description, stack, rules, features, scan summary)
- Funcao `_upsert_wiki_page` para criar ou atualizar paginas por slug
- Builders especializados: `_build_stack_page`, `_build_rules_page`, `_build_features_page`, `_build_scan_page`
- Slugify com suporte a acentos portugueses

**Frontend:**
- Pagina index `/projects/[id]/wiki` com grid de cards, sidebar com arvore de paginas, dialog de criacao, botao de gerar a partir do contexto
- Pagina de visualizacao/edicao `/projects/[id]/wiki/[slug]` com:
  - Sidebar de navegacao com arvore hierarquica
  - Renderizacao Markdown via ReactMarkdown com componentes customizados
  - Edicao inline com preview ao vivo
  - Links internos wiki via prefixo `wiki:slug`
  - Metadados (data de atualizacao, slug)
  - Paginas relacionadas
- Botao "Wiki" na pagina do projeto (ao lado de Consistency)
- Breadcrumb label "Wiki"
- `wikiApi` no frontend com todos os metodos

**Paginas geradas automaticamente:**
1. **Visao Geral** - Description do projeto
2. **Stack Tecnologica** - Framework detectado, scores, indicadores, linguagens no codebase
3. **Regras de Negocio** - Regras extraidas do codebase e entrevistas
4. **Features Principais** - Funcionalidades identificadas
5. **Contexto do Projeto** - context_human quando disponivel
6. **Resumo do Codebase** - Total de arquivos, linguagens

### 2. Contract Language Fix

Traduzidos 10 contratos YAML de ingles para portugues:
1. `memory/pattern_discovery.yaml` - User prompt completo
2. `memory/business_section.yaml` - System prompt
3. `commits/commit_message.yaml` - User prompt (mantido ingles para mensagens de commit)
4. `interviews/orchestrator_sections.yaml` - System prompt
5. `interviews/sections/business.yaml` - System prompt
6. `interviews/sections/design.yaml` - System prompt
7. `interviews/sections/mobile.yaml` - System prompt
8. `interviews/subtask_focused.yaml` - System prompt
9. `interviews/requirements_analyst.yaml` - System prompt
10. `interviews/meta_prompt_contextual.yaml` - System prompt

---

## Files Created

1. **backend/app/models/wiki_page.py** - Modelo SQLAlchemy WikiPage
2. **backend/app/schemas/wiki.py** - Schemas Pydantic (Create, Update, Response, TreeItem)
3. **backend/app/api/routes/wiki.py** - API routes CRUD + generate-from-context
4. **frontend/src/app/projects/[id]/wiki/page.tsx** - Wiki index page
5. **frontend/src/app/projects/[id]/wiki/[slug]/page.tsx** - Wiki page view/edit

## Files Modified

1. **backend/app/models/__init__.py** - Added WikiPage import
2. **backend/app/api/routes/__init__.py** - Added wiki import
3. **backend/app/main.py** - Registered wiki router
4. **frontend/src/lib/api.ts** - Added wikiApi
5. **frontend/src/app/projects/[id]/page.tsx** - Added Wiki button
6. **frontend/src/components/layout/Breadcrumbs.tsx** - Added wiki label
7. **backend/app/contracts/memory/pattern_discovery.yaml** - Translated to PT
8. **backend/app/contracts/memory/business_section.yaml** - Translated to PT
9. **backend/app/contracts/commits/commit_message.yaml** - Translated to PT
10. **backend/app/contracts/interviews/orchestrator_sections.yaml** - Translated to PT
11. **backend/app/contracts/interviews/sections/business.yaml** - Translated to PT
12. **backend/app/contracts/interviews/sections/design.yaml** - Translated to PT
13. **backend/app/contracts/interviews/sections/mobile.yaml** - Translated to PT
14. **backend/app/contracts/interviews/subtask_focused.yaml** - Translated to PT
15. **backend/app/contracts/interviews/requirements_analyst.yaml** - Translated to PT
16. **backend/app/contracts/interviews/meta_prompt_contextual.yaml** - Translated to PT

---

## Testing Results

```
POST /api/v1/projects/{id}/wiki/generate-from-context → 200 OK, 5 pages generated
GET /api/v1/projects/{id}/wiki → 200 OK, returns 5 pages
GET /api/v1/projects/{id}/wiki/stack-tecnologica → 200 OK, rich content with framework scores, indicators, languages
GET /api/v1/projects/{id}/wiki/tree → 200 OK, returns tree structure
```

---

## Key Insights

### 1. FastAPI Route Ordering
Routes with path parameters (`{slug}`) must come AFTER more specific routes (`/generate-from-context`). The initial 404 was caused by `POST /{project_id}/wiki` catching requests before `POST /{project_id}/wiki/generate-from-context` could match.

### 2. Stack Page Content Extraction
The `stack_info` from `initial_memory_context` contains `detected_stack`, `all_scores`, and `indicators_found` but not traditional `languages`/`frameworks` arrays. The `scan_summary.languages` dict provides per-language file counts. The builder was enhanced to extract from both sources.

---

## Status: COMPLETE

**Key Achievements:**
- Wiki real com paginas separadas, navegacao, e edicao inline
- 5 paginas geradas automaticamente a partir do contexto do projeto
- 10 contratos traduzidos para portugues
- Links internos entre paginas wiki
- Sidebar hierarquica com arvore de paginas
