# PROMPT #250 - RAG Nomic Embed Text + Prompt Nodes no AI Flow
## Migração de embeddings e novo tipo de nó visual

**Date:** 2026-02-21
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation + Migration
**Impact:** RAG com embeddings 2x mais ricos (768 dims), pipeline sem chamadas IA, nós de prompt visíveis no AI Flow

---

## 🎯 Objective

Migrar o sistema RAG de all-MiniLM-L6-v2 (384 dims) para Nomic Embed Text via Ollama (768 dims),
eliminando ~700 chamadas de IA por projeto e criando um novo tipo de nó visual (prompt_node) no AI Flow.

**Key Requirements:**
1. Migrar embeddings de MiniLM (384) para Nomic Embed Text (768) via Ollama
2. Indexação direta de arquivos (embedding-only, sem IA)
3. Novo utility node type: `prompt_node` para prompts estruturados reutilizáveis
4. Prompts YAML para extração de regras e geração de cards
5. Configurar AI Flow chains com prompt_nodes

---

## ✅ What Was Implemented

### 1. Migração RAG: MiniLM → Nomic Embed Text

- Removido `sentence-transformers` e `numpy` do `rag_service.py`
- Novo método `_generate_embedding()` que chama Ollama API (`/api/embeddings`)
- Modelo: `nomic-embed-text` (768 dimensões, context 8192 tokens)
- Ollama host configurável via `OLLAMA_HOST` env var
- Migração Alembic: `vector(384)` → `vector(768)` com truncate + reindex

### 2. Cache Service Atualizado

- `cache_service.py` migrado de SentenceTransformer para Nomic via Ollama
- Mesma API de embedding, mesma qualidade de cache semântico

### 3. Indexação Direta (Embedding-Only)

- Novo método `index_files_direct()` em `continuous_rag_service.py`
- Lê arquivos → embedding Nomic → rag_documents (0 chamadas IA)
- Respeita ignore paths, satellite/, .gitignore
- Trunca arquivos >30K chars (limite Nomic context)
- Log de progresso via ConsoleLogger

### 4. Prompt Node (Utility Node Type)

**Backend:**
- `ai_flow_chain.py`: `prompt_node` adicionado ao UTILITY_NODE_TYPES
- `ai_flow.py`: Novo entry no UTILITY_NODE_CATALOG com config (prompt_yaml, repeat, description)
- `utility_node_executor.py`: Handler `_pre_prompt_node()` no PRE_PROCESS_ORDER

**Frontend:**
- `FlowConstants.ts`: Cores indigo (#6366f1), bg, type mapping, pre-process
- `FlowNodes.tsx`: Componente `PromptNodeNode` com YAML path, repetições, descrição
- `FlowIcons.tsx`: Ícone documento/texto SVG
- `EditUtilityNodeDialog.tsx`: Campos editáveis (prompt_yaml, repeat, description)

### 5. Prompts YAML Estruturados

- `backend/app/prompts/rag/extract_rules.yaml`: Instruções para ORBIT AI extrair regras de negócio
- `backend/app/prompts/rag/generate_cards.yaml`: Instruções para gerar hierarquia de cards

### 6. AI Flow Chains Configuradas

- Chain `memory`: prompt_node com `rag/extract_rules` (3 repetições)
- Chain `prompt_generation`: prompt_node com `rag/generate_cards` (1 repetição)

---

## 📁 Files Modified/Created

### Created:
1. **backend/alembic/versions/p250_nomic_embed_768.py** - Migração vector(384)→vector(768)
2. **backend/app/prompts/rag/extract_rules.yaml** - Prompt de extração de regras
3. **backend/app/prompts/rag/generate_cards.yaml** - Prompt de geração de cards

### Modified:
1. **backend/app/services/rag_service.py** - MiniLM→Nomic, novo _generate_embedding()
2. **backend/app/services/cache_service.py** - MiniLM→Nomic para cache semântico
3. **backend/app/services/continuous_rag_service.py** - Novo index_files_direct()
4. **backend/app/schemas/ai_flow_chain.py** - prompt_node no UTILITY_NODE_TYPES
5. **backend/app/api/routes/ai_flow.py** - prompt_node no UTILITY_NODE_CATALOG
6. **backend/app/services/utility_node_executor.py** - _pre_prompt_node() handler
7. **frontend/src/components/ai-flow/FlowConstants.ts** - Cores, bg, mapping para prompt_node
8. **frontend/src/components/ai-flow/FlowNodes.tsx** - PromptNodeNode component
9. **frontend/src/components/ai-flow/FlowIcons.tsx** - Ícone prompt_node
10. **frontend/src/components/ai-flow/EditUtilityNodeDialog.tsx** - Config fields prompt_node

---

## 🧪 Testing Results

### Verification:

```bash
✅ Nomic embedding via Ollama: 768 dims confirmado
✅ Alembic migration: vector(384) → vector(768) executada
✅ Store → Retrieve roundtrip: similarity 0.696 para query relevante
✅ prompt_node registrado no backend catalog
✅ AI Flow chains atualizadas com prompt_nodes
✅ Prompts YAML criados e válidos
```

---

## 🎯 Success Metrics

✅ **Embeddings 2x mais ricos:** 768 dims vs 384 dims anterior
✅ **0 chamadas IA para indexação:** embedding-only via Nomic
✅ **prompt_node visual:** Visível no diagrama AI Flow com config editável
✅ **Prompts estruturados:** YAML reutilizável para extração e geração
✅ **Compatível com pipeline existente:** Fallback chain, rate limiter, etc.

---

## 💡 Key Insights

### 1. Nomic via Ollama é simples e eficiente
API call único (`/api/embeddings`), retorno imediato, sem dependência de sentence-transformers.
Elimina necessidade de carregar modelo Python em memória.

### 2. Embedding-only indexação elimina bottleneck
O pipeline anterior fazia 1 AI call por arquivo (~700 calls). Agora: 0 AI calls para indexação.
Regras de negócio são extraídas por prompt estruturado (3 execuções) via ORBIT AI.

### 3. Prompt Nodes como documentação visual
O prompt_node no AI Flow serve dupla função: documentação visual do pipeline E referência
para execução manual via ORBIT AI. O prompt YAML contém instruções completas.

---

## 🎉 Status: COMPLETE

Migração RAG para Nomic Embed Text concluída com sucesso. Pipeline de indexação
agora usa embedding-only (0 chamadas IA). Novo tipo prompt_node disponível no AI Flow
para armazenar e visualizar prompts estruturados reutilizáveis.

**Key Achievements:**
- ✅ RAG migrado para Nomic Embed Text (768 dims)
- ✅ Indexação sem IA (embedding-only)
- ✅ prompt_node no AI Flow (backend + frontend)
- ✅ 2 prompts YAML estruturados (extract_rules + generate_cards)
- ✅ Chains configuradas com prompt_nodes

**Impact:**
- Embeddings 2x mais ricos para busca semântica
- Eliminação de ~700 chamadas IA por projeto
- Pipeline visual configurável no AI Flow
- Prompts reutilizáveis e versionáveis em YAML

---
