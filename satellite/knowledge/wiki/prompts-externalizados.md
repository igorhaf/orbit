---
title: "Sistema de Prompts YAML"
slug: "prompts-externalizados"
source: "generated"
order_index: 10
created_at: "2026-03-05T04:46:25.328972"
updated_at: "2026-03-05T04:46:25.328972"
---

# Sistema de Prompts Externalizados

## Estrutura

```
backend/app/prompts/
├── backlog/           # 12 prompts de geração de backlog
├── commits/           # 3 prompts de commit messages
├── components/        # 5 componentes reutilizáveis
├── context/           # 8 prompts de contexto e specs
├── discovery/         # 6 prompts de pattern discovery
└── interviews/        # 42 prompts de entrevistas
    ├── card_focused/  # Por tipo de card
    ├── sections/      # Seções especializadas
    └── task_types/    # Por tipo de task
```

**Total: 76 arquivos YAML**

## PromptLoader

```python
from app.prompts.loader import PromptLoader

loader = PromptLoader()
system_prompt, user_prompt = loader.render(
    "backlog/epic_from_interview",
    {"project_name": "ORBIT", "conversation_text": "..."}
)
```

## Schema YAML Obrigatório

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| name | string | Sim |
| version | integer | Sim |
| category | string | Sim |
| description | string | Sim |
| usage_type | string | Sim |
| estimated_tokens | integer | Sim |
| tags | list[string] | Sim |
| variables.required | list[string] | Sim |
| variables.optional | list[string] | Sim |
| system_prompt | Jinja2 template | Sim |
| user_prompt | Jinja2 template | Sim |
| components | list[string] | Não |

## Components
Componentes reutilizáveis em `prompts/components/`:
- `semantic_methodology`: Metodologia N1/P1/E1/AC1
- Injetados via `{{ components.semantic_methodology }}`

