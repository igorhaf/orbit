---
title: "Visão Geral do ORBIT"
slug: "visao-geral"
source: "generated"
order_index: 1
created_at: "2026-03-05T04:46:24.602750"
updated_at: "2026-03-05T04:46:24.602750"
---

# Visão Geral do ORBIT

## O que é o ORBIT?

ORBIT (Orchestrated Repository of Business Intelligence & Tasks) é uma plataforma de orquestração de IA que gerencia múltiplos provedores (Anthropic, OpenAI, Google, Ollama) para automatizar o ciclo de vida de desenvolvimento de software — desde a descoberta de requisitos via entrevistas até a geração de backlog, documentação, e análise de código.

## Principais Capacidades

### Orquestração Multi-Provider
- 4 provedores de IA simultâneos: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Ollama (local)
- Fallback automático entre provedores em caso de falha
- Rate limiting com sliding window por modelo
- Cache em 3 níveis (L1 exact, L2 semantic, L3 template) com economia de ~30% das chamadas

### RAG Pipeline com pgvector
- Busca semântica com Nomic Embed Text (768 dimensões)
- PostgreSQL + pgvector para armazenamento vetorial
- Suporta documentos, código, regras de negócio, respostas de entrevista
- Thresholds configuráveis por contexto (0.5 a 0.85)

### Deep Pipeline (7 Fases)
- Phase 0: Structural Scan (inventário de arquivos)
- Phase 1: Per-File Analysis (Haiku, 10 workers paralelos)
- Phase 2: Cross-File Rule Synthesis (Sonnet, 5 workers)
- Phase 3: Architectural Map (mapa de domínios e dependências)
- Phase 4: Card Generation (hierarquia Epic/Story/Task)
- Phase 5: Wiki Generation (24+ páginas automáticas)
- Phase 6-7: Quality Assurance e Gap Filling

### Entrevistas Contextuais
- 3 fases: perguntas fixas de stack, perguntas dinâmicas de IA, perguntas focadas em cards
- Respostas alimentam RAG para contexto futuro
- Geração automática de backlog a partir de entrevistas

### Token Reduction (70-85%)
- 47 especificações de frameworks no banco de dados
- Injeção seletiva baseada no stack do projeto
- Redução de 60-80% na geração + 15-20% na execução

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + SQLAlchemy + PostgreSQL + pgvector |
| Frontend | Next.js 14 App Router + React 18 + TypeScript + Tailwind CSS |
| Cache | Redis 7 (3 níveis) |
| Embeddings | Nomic Embed Text via Ollama (768d) |
| AI Providers | Anthropic, OpenAI, Google, Ollama |
| Migrations | Alembic |

## Métricas do Projeto

- **1,284 arquivos** (354 Python, 180 TypeScript, 165 YAML, 91 migrations)
- **17 domínios** identificados
- **48 regras de negócio** extraídas do código
- **76 prompts YAML** externalizados
- **14 Epics, 27 Stories, 87 Tasks** = 128 cards totais

