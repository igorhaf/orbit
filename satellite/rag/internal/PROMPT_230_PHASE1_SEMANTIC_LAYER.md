# PROMPT #230 - Pipeline Incremental por Lotes (Fase 1)
## Classificação de Arquivos por Camada Semântica

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Arquivos processados na ordem correta (Schema primeiro, Config por último), fundação para pipeline incremental

---

## Objective

Classificar cada arquivo do projeto em 5 camadas semânticas (Schema, Routes, Logic, Presentation, Config) de forma stack-agnostic, e processar na ordem Schema -> Routes -> Logic -> Presentation -> Config.

**Key Requirements:**
1. Enum `FileSemanticLayer` no modelo RAGFileState
2. Classificador `_classify_semantic_layer()` baseado em padrões de path (não framework-specific)
3. Query `process_pending_files()` ordenada por prioridade de camada
4. Migration com backfill de dados existentes
5. Funcionar para Laravel, Next.js, Django, Spring, Go, Rails

---

## What Was Implemented

### 1. Enum FileSemanticLayer (rag_file_state.py)
- `SCHEMA` (priority 1): migrations, models, entities, schemas, domain, prisma, graphql, proto
- `ROUTES` (priority 2): controllers, handlers, routes, endpoints, API, resolvers
- `LOGIC` (priority 3): services, use cases, actions, jobs, workers, events, listeners, policies, middleware, validators, requests
- `PRESENTATION` (priority 4): views, components, templates, pages, layouts, .blade.php, .vue, .jsx, .tsx
- `CONFIG` (priority 5): config, bootstrap, providers, docker, package.json, composer.json
- `UNKNOWN` (priority 6): files that don't match any pattern

### 2. Classificador Stack-Agnostic (_classify_semantic_layer)
- Baseado em padrões de path, não em nomes de framework
- Suporta paths com e sem leading slash (e.g., `config/app.php` e `/config/app.php`)
- Case-insensitive (normaliza para lowercase)
- 80+ padrões cobrindo os principais frameworks e linguagens

### 3. Ordenação por Prioridade em process_pending_files()
- SQLAlchemy `case()` expression para ordenar query por camada
- Schema processado primeiro (estrutura do BD informa todo o resto)
- Config processado por último (menos relevante para regras de negócio)

### 4. Classificação no Scan
- `scan_for_changes()` classifica novos arquivos automaticamente
- Arquivos modificados recebem reclassificação se estavam como UNKNOWN

### 5. Retorno Enriquecido
- `process_pending_files()` agora retorna `rules_by_layer` (contagem de regras por camada)

---

## Files Modified/Created

### Created:
1. **alembic/versions/p230a1b2c3d4_add_file_semantic_layer.py** - Migration
   - Cria enum `file_semantic_layer` no PostgreSQL
   - Adiciona coluna `file_layer` com default 'unknown'
   - Indices: `ix_rag_file_state_file_layer`, `ix_rag_file_state_project_layer_status`
   - Backfill via regex PostgreSQL `~*` com cast para enum

### Modified:
1. **backend/app/models/rag_file_state.py** - +20 lines
   - Enum `FileSemanticLayer` (6 valores)
   - Coluna `file_layer` no modelo
   - `to_dict()` inclui `file_layer`
   - `__repr__` inclui layer

2. **backend/app/services/continuous_rag_service.py** - +90 lines
   - Import de `FileSemanticLayer`
   - Constante `LAYER_PRIORITY` (mapeamento camada -> prioridade)
   - Metodo `_classify_semantic_layer()` (80+ padroes stack-agnostic)
   - `scan_for_changes()`: classifica ao criar/atualizar RAGFileState
   - `process_pending_files()`: query ordenada por camada, retorno com `rules_by_layer`

3. **backend/app/contracts/memory/continuous_rag_extract.yaml** - +1 line
   - Campo `file_layer` no output JSON

---

## Testing Results

### Verificacao - Projeto Suinda (Laravel):

```
file_layer   | count
-------------|------
presentation |    91  (blade.php, views)
routes       |    62  (controllers, routes/)
unknown      |    35  (tests, seeders, factories, css)
schema       |    34  (models, migrations, database/)
config       |    16  (config/, bootstrap/, providers/)
logic        |    11  (services, policies, requests, middleware)
```

- Schema corretamente inclui: models/, migrations/, database/
- Routes corretamente inclui: Controllers/, routes/web.php
- Logic corretamente inclui: Policies/, Requests/, middleware
- Presentation corretamente inclui: views/*.blade.php
- Config corretamente inclui: config/*.php, bootstrap/
- Unknown: tests, seeders, factories (arquivos de baixo valor)

---

## Success Metrics

- **Classificacao funcional**: 86% dos arquivos classificados (214/249)
- **Stack-agnostic**: Padroes cobrem Laravel, Django, Spring, Next.js, Go, Rails
- **Ordenacao correta**: Schema processado antes de tudo, Config por ultimo
- **Zero breaking changes**: Coluna nullable com default, backward compatible

---

## Key Insights

### 1. Paths sem Leading Slash
Arquivos em root-level dirs (e.g., `config/app.php`, `routes/web.php`, `bootstrap/app.php`) precisam de padroes especiais sem leading slash alem dos padroes com `/config/`.

### 2. PostgreSQL Enum Cast
O backfill SQL precisa de cast explicito `::file_semantic_layer` ao usar CASE com strings para coluna de tipo enum.

### 3. Backfill com server_default
Quando a coluna tem `server_default='unknown'`, o backfill nao pode usar `WHERE IS NULL` - precisa `WHERE file_layer = 'unknown'`.

---

## Status: COMPLETE

Fase 1 implementada e verificada. Fundacao para pipeline incremental por lotes (Fases 2-5).

**Key Achievements:**
- Classificacao stack-agnostic funcionando
- Processamento ordenado por camada semantica
- Migration com backfill automatico
- Retorno enriquecido com `rules_by_layer`

**Impact:**
- Arquivos Schema (models, migrations) processados primeiro, informando melhor a extracao de regras dos arquivos seguintes
- Base para Fases 2-5: contexto incremental, wiki padronizada, cards hierarquicos
