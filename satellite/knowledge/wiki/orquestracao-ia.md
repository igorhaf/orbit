---
title: "Orquestração de IA"
slug: "orquestracao-ia"
source: "generated"
order_index: 3
created_at: "2026-03-05T04:46:24.777496"
updated_at: "2026-03-05T04:46:24.777496"
---

# Orquestração de IA

## AIOrchestrator

O `AIOrchestrator` é o coração do ORBIT — hub central que gerencia todas as chamadas a provedores de IA.

### Arquivo Principal
`backend/app/services/ai_orchestrator/orchestrator.py` (~106KB)

### Como Funciona

```
┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│ Service Call  │───>│ AIOrchestrator │───>│ Provider     │
│ (any usage)  │    │                │    │ Adapter      │
└──────────────┘    │ 1. Cache check │    │              │
                    │ 2. Model select│    │ ┌──────────┐ │
                    │ 3. Rate limit  │    │ │ Anthropic │ │
                    │ 4. Execute     │    │ │ OpenAI   │ │
                    │ 5. Log usage   │    │ │ Google   │ │
                    │ 6. Cache store │    │ │ Ollama   │ │
                    └───────────────┘    │ └──────────┘ │
                                         └──────────────┘
```

### Resolução de Modelo

1. Busca modelo configurado para o `usage_type` específico
2. Se não encontra, busca modelo com usage_type `general`
3. Se não encontra, usa `choose_model()` auto-selection
4. Se provider falha, adiciona a `_skip_providers` e tenta próximo

### Compatibilidade de Providers

| Provider | System Prompt | Roles | SDK |
|----------|---------------|-------|-----|
| Anthropic | Parâmetro `system` separado | user, assistant | anthropic.Anthropic() |
| OpenAI | Message role='system' | system, user, assistant | openai.OpenAI() |
| Google | system_instruction text | user, model | google.generativeai |
| Ollama | Message role='system' | system, user, assistant | HTTP direto |

### Regra de Ouro
**Todo código interno usa apenas roles `user` e `assistant`** com system_prompt como parâmetro separado. O AIOrchestrator converte para o formato de cada provider.

### Usage Types

| Usage Type | Modelo Padrão | Uso |
|-----------|---------------|-----|
| interview | Claude Haiku 4 | Perguntas de entrevista |
| prompt_generation | GPT-4o | Geração de tarefas |
| task_execution | Claude Sonnet 4.5 | Execução de código |
| commit_generation | Gemini 1.5 Pro | Mensagens de commit |
| general | Claude Sonnet 4.5 | Fallback geral |

