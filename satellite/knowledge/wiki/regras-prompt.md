---
title: "Regras de Prompt"
slug: "regras-prompt"
source: bootstrap
order: 3
created_at: "2026-03-05T07:12:22.270721+00:00"
---

# Regras de Prompt

## Princípios Fundamentais

### 1. Prompts Externalizados para YAML

Todos os prompts de IA são armazenados em arquivos YAML na pasta `backend/app/prompts/`.

**Estrutura de um prompt YAML:**
```yaml
name: epic_from_interview
version: 1
category: backlog
description: Gera Epic a partir de conversa de entrevista
usage_type: prompt_generation

variables:
  required:
    - project_name
    - conversation_text
  optional:
    - semantic_map_text

components:
  - semantic_methodology

system_prompt: |
  Você é um Product Owner especialista...
  {{ components.semantic_methodology }}

user_prompt: |
  Analise esta conversa: {{ conversation_text }}
  Projeto: {{ project_name }}
```

### 2. PromptLoader

```python
from app.prompts.loader import PromptLoader

loader = PromptLoader()
system_prompt, user_prompt = loader.render(
    "backlog/epic_from_interview",
    {"project_name": "Meu App", "conversation_text": "..."}
)
```

### 3. Compatibilidade Multi-Provider

- Messages: apenas roles `user` e `assistant`
- System prompt: parâmetro separado (nunca como message)
- AIOrchestrator converte para formato de cada provider

### 4. Componentes Reutilizáveis

- `semantic_methodology.yaml`: Metodologia de referências semânticas
- `project_context.yaml`: Template de contexto do projeto
- `json_output_rules.yaml`: Regras de formatação JSON de saída

## Categorias de Prompts (76 arquivos YAML)

| Categoria | Quantidade | Descrição |
|-----------|-----------|-----------|
| interviews/ | 25 | Entrevistas contextuais |
| context/ | 18 | Contexto e especificações |
| backlog/ | 8 | Geração de backlog |
| projects/ | 5 | Operações de projeto |
| wiki/ | 4 | Operações de wiki |
| discovery/ | 3 | Descoberta de padrões |
| memory/ | 3 | Consolidação de memória |
| rag/ | 3 | Pipeline RAG |
| components/ | 3 | Componentes reutilizáveis |
| commits/ | 1 | Mensagens de commit |
| utility/ | 1 | Formatação |
