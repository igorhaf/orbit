---
title: "Fluxo de Execução dos Agentes"
slug: "fluxo-agentes"
source: bootstrap
order: 2
created_at: "2026-03-05T07:12:22.270430+00:00"
---

# Fluxo de Execução dos Agentes

## Pipeline de Processamento

### 1. Captura de Requisitos (Entrevista)

```
Usuário inicia entrevista
    → Perguntas de stack (fixas)
    → Perguntas dinâmicas (IA)
    → Contexto semântico gerado
    → Respostas indexadas no RAG
```

### 2. Geração de Backlog

```
Entrevista concluída
    → Generate Epic (IA)
    → Usuário aprova Epic
    → Generate Stories (IA)
    → Usuário aprova Stories
    → Generate Tasks (IA + framework specs)
    → Detecção de modificação (>90% similaridade)
    → Usuário aprova Tasks
```

### 3. Execução de Código

```
Task selecionada
    → RAG retrieval (contexto relevante)
    → Framework specs (redução 70-85% tokens)
    → AIOrchestrator.execute()
    → Cache check (L1 → L2 → L3)
    → API call (se cache miss)
    → Cost tracking
    → Resultado armazenado
```

### 4. RAG Pipeline Contínuo

```
Fase 1: Scan → Embedding de arquivos
Fase 2: Extract Rules → IA extrai regras de negócio
Fase 3: Generate Cards → Cria cards a partir de regras
Fase 4: Generate Wiki → Cria wiki a partir de conhecimento
```

## Roteamento de Modelos

| Usage Type | Provider Padrão | Modelo |
|------------|----------------|--------|
| task_execution | Anthropic | Claude Sonnet 4.5 |
| interview | Anthropic | Claude Haiku 4 |
| prompt_generation | OpenAI | GPT-4o |
| commit_generation | Google | Gemini 1.5 Pro |
| general | Anthropic | Claude Sonnet 4.5 |

## Complexidade → Modelo

| Complexidade | Modelo Sugerido |
|-------------|----------------|
| low | Claude Haiku 4 |
| medium | Claude Sonnet 4.5 |
| high | Claude Opus 4.5 |
