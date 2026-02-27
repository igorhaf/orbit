# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 1482 in / 717 out | Cost: $0.0051

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/prompts/context/draft_subtasks.yaml (yaml):
# Prompt: Draft Subtasks Generation (Titles)
# Source: context_generator.py:2100-2133
# PROMPT #102 - Hierarchical Draft Generation

name: draft_subtasks
version: 1
category: context
description: Gera 3-5 títulos de Subtasks atômicas a partir de uma Task ativada
usage_type: prompt_generation
estimated_tokens: 1000
tags:
  - subtask
  - draft
  - titles
  - decomposition

variables:
  required:
    - task_title
    - task_description
  optional:
    - task_specification
    - semantic_map_text
    - business_rules_text

components: []

system_prompt: |
  Você é um Desenvolvedor Sênior especialista em decomposição de Tasks.

  TAREFA: Decomponha a Task em 3-5 Subtasks atômicas. Retorne APENAS os TÍTULOS.

  FORMATO: Cada título deve descrever uma ação específica e implementável.

  **TIPOS DE SUBTASKS A INCLUIR:**
  - Implementação de função/método específico
  - Configuração de dependência/biblioteca
  - Criação/modificação de arquivo
  - Implementação de validação
  - Tratamento de erro específico
  - Escrita de teste
  - Refatoração de código

  Retorne APENAS um array JSON com os títulos:
  ["título 1", "título 2", ..., "título N"]

  NÃO inclua nenhuma explicação, apenas o array JSON.

  ## REGRA GERAL
  - NUNCA use emojis ou símbolos especiais nas respostas

user_prompt: |
  Decomponha esta Task em 3-5 Subtasks atômicas.

  {% if business_rules_text %}
  {{ business_rules_text }}

  ATENÇÃO: As Subtasks devem implementar as regras de negócio que se aplicam a esta Task.
  {% endif %}

  ## TASK
  **Título:** {{ task_title }}
  **Descrição:** {{ task_description | default('Não especificada') }}
  {% if task_specification %}
  **Especificação:** {{ task_specification[:1000] }}
  {% endif %}
  {% if semantic_map_text %}
  {{ semantic_map_text }}
  {% endif %}

  Retorne APENAS o array JSON com 3-5 títulos de Subtasks.
  {% if business_rules_text %}
  Certifique-se de incluir subtasks que validem/implementem as regras de negócio aplicáveis.
  {% endif %}


## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode solicitar a decomposição de uma Task em 3-5 subtasks atômicas, que devem ser específicas e implementáveis.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "As subtasks geradas devem incluir validações ou implementações das regras de negócio aplicáveis à Task, se especificadas no contexto.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema deve garantir que as subtasks sejam do tipo: implementação de função, configuração de dependência, criação/modificação de arquivo, validação, tratamento de erro, escrita de teste ou refatoração de código.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "A resposta deve ser um array JSON contendo apenas os títulos das subtasks, sem explicações adicionais ou símbolos especiais.",
      "rule_type": "format",
      "confidence": "high"
    },
    {
      "rule_text": "A decomposição deve respeitar limites de 3 a 5 subtasks, sendo obrigatório retornar exatamente esse número quando a Task for adequada para essa divisão.",
      "rule_type": "constraint",
      "confidence": "high"
    }
  ]
}
