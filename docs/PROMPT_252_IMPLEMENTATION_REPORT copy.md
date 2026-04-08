# PROMPT #252 - Pipeline RAG: 4 Botoes Progressivos com Fila Redis
## Wizard Stepper com Desbloqueio Progressivo

**Date:** February 21, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Pipeline RAG manual com 4 fases progressivas controladas pelo usuario

---

## Objective

Implementar um fluxo **manual e progressivo** onde cada fase do pipeline RAG e um botao separado, desbloqueado somente apos a fase anterior completar. O usuario controla quando cada fase executa via wizard stepper visual no Overview do projeto.

**Fluxo:**
1. Scan Documentos -> Fase 1: Indexa arquivos no RAG (embedding Nomic, sem IA)
2. Extrair Regras -> Fase 2: IA extrai regras de negocio (usage_type=task_execution)
3. Gerar Cards -> Fase 3: Gera cards a partir das regras (cards FECHADOS)
4. Gerar Wiki -> Fase 4: Gera wiki + titulo + descricao (1 prompt ao Claudio)

**Key Requirements:**
1. Cada fase e um botao separado com desbloqueio progressivo
2. Estado do pipeline armazenado no Redis com fallback para DB
3. Wizard stepper visual com bolinhas, linhas e animacao de loading
4. Cards gerados ja vem FECHADOS (workflow_state="done")
5. Wiki pages indexadas no RAG (type=wiki_page)
6. REGRA #0: titulo/descricao so gerados se vazios

---

## What Was Implemented

### 1. Novo Status INDEXED no Enum
Adicionado status intermediario `INDEXED` entre PROCESSING e COMPLETED para representar arquivos com embedding armazenado mas sem regras de negocio extraidas.

### 2. RagPipelineService (4 Fases)
Servico central que orquestra as 4 fases do pipeline:
- `phase_1_index_files()`: Scan filesystem + embed via Nomic (sem IA)
- `phase_2_extract_rules()`: IA extrai regras via AIOrchestrator(task_execution)
- `phase_3_generate_cards()`: Gera cards via generate_cards_from_memory(), fecha com workflow_state="done"
- `phase_4_generate_wiki()`: Gera wiki pages, indexa no RAG, gera titulo+descricao (REGRA #0)

### 3. Estado no Redis
Hash em `rag:pipeline:{project_id}` com status de cada fase (pending/running/completed/failed). Fallback para derivacao a partir do banco de dados.

### 4. Prompt YAML para Wiki + Titulo + Descricao
Prompt externalizado em YAML para gerar titulo e descricao do projeto a partir das regras de negocio.

### 5. Endpoints Backend (3 novos + 1 modificado)
- `POST /rag/scan` - Modificado para usar RagPipelineService.phase_1
- `POST /rag/extract-rules` - NOVO: Fase 2
- `POST /rag/generate-cards` - NOVO: Fase 3
- `POST /rag/generate-wiki` - NOVO: Fase 4
- `GET /rag/enrichment-status` - Expandido com campos pipeline_phase_1..4, has_indexed_files, has_business_rules, has_cards, has_wiki

### 6. Frontend Wizard Stepper
Componente visual com 4 bolinhas conectadas por linhas:
- **Bloqueado**: cinza, cursor-not-allowed
- **Disponivel**: azul, clicavel
- **Em andamento**: borda azul animada (spin)
- **Completo**: verde com checkmark
- Texto descritivo abaixo do stepper indica acao atual

### 7. API Client (3 novos metodos)
- `ragApi.extractRules(projectId)`
- `ragApi.generateCards(projectId)`
- `ragApi.generateWiki(projectId)`

---

## Files Created

1. **backend/alembic/versions/p252_indexed_status.py** - Migration: add INDEXED to enum
2. **backend/app/services/rag_pipeline.py** - Servico pipeline com 4 fases (~400 linhas)
3. **backend/app/prompts/rag/generate_wiki_and_info.yaml** - Prompt YAML titulo+descricao

## Files Modified

4. **backend/app/models/rag_file_state.py** - INDEXED adicionado ao FileProcessingStatus enum
5. **backend/app/api/routes/continuous_rag.py** - 3 endpoints novos + enrichment-status expandido + scan modificado
6. **frontend/src/app/projects/[id]/page.tsx** - Wizard stepper com 4 bolinhas progressivas
7. **frontend/src/lib/api/knowledge.ts** - 3 novos metodos API (extract-rules, generate-cards, generate-wiki)

---

## Testing Results

```
OK Lint: 0 erros, warnings pre-existentes apenas
OK Backend: endpoints criados com validacao de pre-requisitos
OK Frontend: wizard stepper renderiza corretamente
OK Pipeline: estado gerenciado via Redis com fallback DB
OK REGRA #0: titulo/descricao so gerados se vazios
```

---

## Key Insights

### 1. Desbloqueio Progressivo via enrichment-status
O frontend polls enrichment-status a cada 5s e usa os novos campos `has_indexed_files`, `has_business_rules`, `has_cards` para determinar quais botoes desbloquear.

### 2. Redis + DB Fallback
O estado do pipeline vive no Redis para performance, mas se Redis nao estiver disponivel, o endpoint deriva o estado a partir de queries no banco (contagem de rag_documents por tipo, tasks, wiki_fs).

### 3. Cards FECHADOS
Fase 3 gera cards via `generate_cards_from_memory()` existente e depois marca todos os cards gerados com `workflow_state="done"` - eles representam o que JA foi desenvolvido.

---

## Status: COMPLETE

**Key Achievements:**
- 4 fases do pipeline RAG com botoes progressivos
- Wizard stepper visual com animacoes de loading
- Estado gerenciado via Redis com fallback DB
- Wiki pages indexadas no RAG para busca semantica
- REGRA #0 respeitada (dados humanos sagrados)
- Cards de regras de negocio vem fechados

**Impact:**
- Usuario tem controle total sobre cada fase do pipeline
- Interface visual clara mostra progresso do projeto
- Arquitetura escalavel com Redis para estado de pipeline
