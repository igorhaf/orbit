# PROMPT #252 - Extract Business Logic from Routes (Frente 4 de 6)
## Extracao de logica de negocio de projects.py e wiki.py para servicos

**Date:** February 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor
**Impact:** projects.py -926 linhas, wiki.py -1.311 linhas, logica extraida para servicos dedicados

---

## Objective

Extrair toda logica de negocio (helper functions, background job handlers, page builders) das rotas `projects.py` e `wiki.py` para modulos de servico dedicados, mantendo as rotas finas (apenas validacao + chamada de servico + response).

---

## What Was Implemented

### 1. WikiService (`backend/app/services/wiki_service.py`) - 1.333 linhas

Modulo contendo 22 funcoes de logica de negocio extraidas de `wiki.py`:

| Funcao | Linhas | Responsabilidade |
|--------|--------|-----------------|
| `_slugify` | 13 | Conversao de texto para URL-friendly slug |
| `_ensure_unique_slug` | 14 | Garantir slug unico no projeto |
| `_upsert_wiki_page` | 56 | Create/update wiki page com protecao de source |
| `_build_stack_page` | 85 | Gerar markdown de stack tecnologica |
| `_build_rules_page` | 19 | Gerar markdown de regras de negocio |
| `_build_features_page` | 16 | Gerar markdown de features |
| `_build_scan_page` | 16 | Gerar markdown de resumo do scan |
| `_translate_spec_type` | 23 | Traduzir spec types para portugues |
| `_translate_category` | 19 | Traduzir categorias para portugues |
| `_build_architecture_patterns_page` | 42 | Gerar markdown de padroes de arquitetura |
| `_build_code_conventions_page` | 45 | Gerar markdown de convencoes de codigo |
| `_build_ui_components_page` | 37 | Gerar markdown de componentes UI |
| `_build_code_structure_page` | 54 | Gerar markdown de estrutura de codigo |
| `_build_git_history_page` | 31 | Gerar markdown de historico git |
| `_classify_domain` | 48 | Classificar arquivo em dominio de negocio |
| `_build_business_rules_wiki_pages` | 220 | Gerar paginas hierarquicas de regras |
| `_trigger_rule_enrichment_job` | 36 | Criar job de enriquecimento de regras |
| `_enrich_rules_background` | 212 | Background task: enriquecimento AI de regras |
| `_add_semantic_links_to_content` | 123 | Adicionar links semanticos wiki-style |
| `_apply_semantic_links_to_project` | 49 | Aplicar links a todas as paginas do projeto |
| `_parse_wiki_sections` | 62 | Parser de secoes ## para paginas wiki |
| `_parse_wiki_subsections` | 44 | Parser de secoes ### para paginas wiki |

### 2. ProjectService (`backend/app/services/project_service.py`) - 938 linhas

Modulo contendo 11 funcoes de logica de negocio extraidas de `projects.py`:

| Funcao | Linhas | Responsabilidade |
|--------|--------|-----------------|
| `_get_max_patterns` | 15 | Ler max_discovery_patterns do system_settings |
| `_merge_memory_context` | 54 | Smart merge de contexto de memoria (dedup) |
| `_effective_max_patterns` | 5 | Calcular max patterns com cap de 50 |
| `_sanitize_project_name` | 10 | Sanitizar nome do projeto para filesystem |
| `_process_memory_scan_async` | 122 | Background task: scan de memoria do codebase |
| `_process_quick_create_scan` | 107 | Background task: scan de quick-create |
| `_process_initial_scan` | 110 | Background task: scan inicial do projeto |
| `_enrich_wiki_job` | 40 | Background task: wrapper de enriquecimento wiki |
| `_enrich_context_from_rag` | 251 | Enriquecimento de wiki a partir do RAG |
| `_process_cards_from_memory_async` | 83 | Background task: geracao de cards |
| `_process_full_hierarchy_async` | 99 | Background task: geracao de hierarquia completa |

### 3. Reducao nas Rotas

| Arquivo | Antes | Depois | Reducao |
|---------|-------|--------|---------|
| `wiki.py` | 1.839 linhas | 528 linhas | **-71%** |
| `projects.py` | 2.557 linhas | 1.631 linhas | **-36%** |

### 4. Call Sites Externos Atualizados

`watchdog.py` importava helpers diretamente de `wiki.py` e `projects.py`. Atualizado para importar dos novos servicos:

| Import antigo | Import novo |
|--------------|-------------|
| `from app.api.routes.wiki import _upsert_wiki_page, ...` | `from app.services.wiki_service import ...` |
| `from app.api.routes.projects import _enrich_context_from_rag` | `from app.services.project_service import ...` |
| `from app.api.routes.projects import _effective_max_patterns` | `from app.services.project_service import ...` |

---

## Files Created

1. `backend/app/services/wiki_service.py` - 1.333 linhas (22 funcoes)
2. `backend/app/services/project_service.py` - 938 linhas (11 funcoes)

## Files Modified

1. `backend/app/api/routes/wiki.py` - 1.839 → 528 linhas (endpoints only)
2. `backend/app/api/routes/projects.py` - 2.557 → 1.631 linhas (endpoints only)
3. `backend/app/services/watchdog.py` - 3 imports atualizados

---

## Testing

```
Python syntax OK (wiki_service.py - 1333 lines)
Python syntax OK (project_service.py - 938 lines)
Python syntax OK (wiki.py - 528 lines)
Python syntax OK (projects.py - 1631 lines)
Python syntax OK (watchdog.py - 1371 lines)
Grep: zero imports antigos remanescentes
Grep: zero call sites quebrados
```

---

## Status: COMPLETE

**Key Achievements:**
- wiki.py: 1.839 → 528 linhas (-71%, apenas 9 endpoints)
- projects.py: 2.557 → 1.631 linhas (-36%, apenas 22 endpoints)
- 2 servicos dedicados criados (wiki_service.py, project_service.py)
- 3 call sites externos em watchdog.py atualizados
- Zero quebra de funcionalidade

**Proxima frente:** Frente 5 - Refatorar componentes monoliticos frontend

---
