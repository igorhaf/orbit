---
title: "Visão Geral do ORBIT"
slug: "visao-geral"
source: bootstrap
order: 0
created_at: "2026-03-05T07:12:22.269332+00:00"
---

# Visão Geral do ORBIT

## O que é o ORBIT?

ORBIT é um **sistema de orquestração de IA** projetado para gerenciar múltiplos modelos de inteligência artificial e automatizar o ciclo completo de desenvolvimento de software — da captura de requisitos à geração de código.

## Missão

Orquestrar diferentes providers de IA (Anthropic Claude, OpenAI GPT, Google Gemini) de forma transparente, roteando cada tipo de tarefa para o modelo mais adequado, enquanto mantém cache inteligente, cost tracking e base de conhecimento semântica.

## Principais Capacidades

- **Entrevistas Contextuais**: Captura de requisitos via entrevistas interativas com IA
- **Geração de Backlog**: Conversão automática de requisitos em hierarquia Epic → Story → Task
- **RAG Pipeline**: Base de conhecimento semântica com pgvector e embeddings Nomic (768d)
- **Execução de Código**: Geração de código assistida por IA com especificações de framework
- **Wiki Automática**: Geração e enriquecimento de documentação por IA
- **Cache Multi-Nível**: 3 níveis de cache Redis (L1-L3) com economia de 30-35% em custos

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| Backend | FastAPI + SQLAlchemy + PostgreSQL + Alembic |
| Frontend | Next.js 14 App Router + React + TypeScript + Tailwind CSS |
| IA | Claude API + OpenAI API + Google AI via AIOrchestrator |
| Vetores | pgvector + Nomic Embed Text (768d) via Ollama |
| Cache | Redis multi-nível (L1 exact, L2 semantic, L3 template) |
| Jobs | PriorityJobExecutor com fila de prioridade |
