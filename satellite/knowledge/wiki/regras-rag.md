---
title: "Regras de RAG"
slug: "regras-rag"
source: bootstrap
order: 4
created_at: "2026-03-05T07:12:22.271001+00:00"
---

# Regras de RAG

## Configuração

| Parâmetro | Valor |
|-----------|-------|
| Modelo de Embedding | Nomic Embed Text |
| Dimensões | 768 |
| Runtime | Ollama (host: 172.27.144.1:11434) |
| Banco de Dados | PostgreSQL + pgvector |
| Distância | Cosseno (operador `<=>`) |
| Tabela | `rag_documents` |

## Tipos de Documentos no RAG

| Tipo | Descrição |
|------|-----------|
| `code_file` | Arquivo de código fonte |
| `interview_answer` | Resposta de entrevista |
| `interview_question` | Pergunta de entrevista |
| `business_rule` | Regra de negócio extraída |
| `document` | Documento enviado |
| `document_chunk` | Chunk de documento |
| `discovered_pattern` | Padrão descoberto |
| `project_context` | Contexto do projeto |
| `card` | Card do backlog |
| `domain_template` | Template de domínio |

## Pipeline de 4 Fases

### Fase 1: Scan de Arquivos
- Scanner percorre filesystem do projeto
- Respeita .gitignore e IGNORE_DIRECTORIES
- Gera embedding via Nomic para cada arquivo
- Estado: PENDING → INDEXED
- Não usa IA (apenas embedding)

### Fase 2: Extração de Regras
- Requer Fase 1 completa
- IA analisa arquivos indexados
- Extrai regras de negócio estruturadas
- Estado: INDEXED → COMPLETED

### Fase 3: Geração de Cards
- Requer Fase 2 completa
- Gera Epic/Story/Task a partir de regras
- Usa detecção de modificação (>90% similaridade)

### Fase 4: Geração de Wiki
- Requer Fase 3 completa
- Cria wiki pages a partir do conhecimento extraído
- Enriquece com linking semântico

## Deep Pipeline (7 Fases via Claudio)

O Deep Pipeline (PROMPT #260) executa todas as 4 fases básicas mais 3 fases avançadas:
- Análise arquitetural completa
- Mapeamento de dependências
- Geração de documentação abrangente

## Chunking

- Tamanho padrão: 500 caracteres
- Overlap: 50 caracteres
- Preservação de estrutura (headers, blocos de código)
- Metadados por chunk: tipo, fonte, índice, total
