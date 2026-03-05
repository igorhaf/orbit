---
title: "Gestão de Projetos"
slug: "gestao-projetos"
source: "generated"
order_index: 18
created_at: "2026-03-05T04:46:25.881420"
updated_at: "2026-03-05T04:46:25.881420"
---

# Gestão de Projetos Core

## Criação de Projeto

### POST /api/v1/projects/create-and-process
1. Cria projeto no banco com metadata (name, description, code_path)
2. Cria satellite directory: `{code_path}/satellite/`
3. Subdirectories: memory/, docs/, knowledge/, knowledge/wiki/, knowledge/results/, knowledge/prompts/
4. Detecta stack via tech_stack_detector
5. Configura git_info (remote URL, branch)
6. Inicia scan inicial de arquivos

## Metadata do Projeto

| Campo | Tipo | Descrição |
|-------|------|-----------|
| name | string | Nome do projeto |
| description | text | Descrição legível |
| code_path | string | Caminho do repositório |
| stack | string | Tecnologias (ex: fastapi/nextjs/postgresql) |
| status | enum | active, archived |
| git_info | JSON | Remote URL, branch, last commit |
| context_semantic | JSON | Mapa arquitetural para AI |
| context_human | text | Descrição legível para display |

## AI Models

### Tabela ai_models
- name, provider, model_id, api_key, usage_types[], is_active
- **API keys no banco, NUNCA no .env**
- Página `/ai-models` para CRUD

### Usage Type Routing
| Usage Type | Propósito |
|-----------|-----------|
| interview | Perguntas de entrevista |
| prompt_generation | Geração de tarefas |
| task_execution | Execução de código |
| commit_generation | Mensagens de commit |
| general | Fallback |

