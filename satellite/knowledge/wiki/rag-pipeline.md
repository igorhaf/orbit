---
title: "RAG Pipeline com pgvector"
slug: "rag-pipeline"
source: "generated"
order_index: 4
created_at: "2026-03-05T04:46:24.859641"
updated_at: "2026-03-05T04:46:24.859641"
---

# RAG Pipeline com pgvector

## Visão Geral

O RAG (Retrieval-Augmented Generation) do ORBIT usa PostgreSQL + pgvector para busca semântica de documentos, código, regras de negócio, e respostas de entrevista.

### Arquivo Principal
`backend/app/services/rag_service.py` (~39KB)

## Componentes

### Embedding Model
- **Modelo:** Nomic Embed Text via Ollama
- **Dimensões:** 768
- **Endpoint:** http://172.27.144.1:11434/api/embeddings
- **Timeout:** 30 segundos
- **Distância:** Coseno (operador `<=>` do pgvector)

### Tipos de Documento

| Tipo | Metadata type | Chunking | Descrição |
|------|--------------|----------|-----------|
| document | document | 1500 chars, 200 overlap | Markdown docs |
| code_file | code_file | 800 chars, 100 overlap | Código fonte |
| business_rule | business_rule | sem chunking | Regras extraídas |
| card | card | sem chunking | Epic/Story/Task |
| interview_answer | interview_answer | sem chunking | Respostas |

### Similarity Thresholds

| Contexto | Threshold | Justificativa |
|----------|-----------|---------------|
| Card deduplication | 0.85 | Match estrito para evitar falsos positivos |
| Search results | 0.70 | Busca geral equilibrada |
| Interview answers | 0.60 | Mais permissivo para contexto |
| Business rules | 0.50 | Amplo para capturar regras relacionadas |

## Operações

### store(content, metadata, project_id)
1. Gera embedding via Nomic
2. Chunka se > threshold
3. Insere em rag_documents com embedding vector(768)

### search(query, project_id, top_k, threshold)
1. Gera embedding da query
2. Busca cosine distance < (1 - threshold)
3. Filtra por project_id e metadata
4. Retorna top_k resultados com similarity score

### Continuous Evolution Pipeline
```
scan (detect changes) → extract rules → generate cards → generate wiki
     pending → scanned → indexed → enriched (file states)
```

