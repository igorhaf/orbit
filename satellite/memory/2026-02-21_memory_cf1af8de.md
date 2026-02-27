# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 1870 in / 731 out | Cost: $0.0055

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/contracts/memory/codebase_analysis.yaml (yaml):
name: codebase_analysis
version: 3
category: memory
description: Análise de codebase via mapa de símbolos para extração de regras de negócio - PROMPT #230
usage_type: memory
estimated_tokens: 1500
tags:
  - memory
  - analysis
  - business_rules
  - multi_phase
  - symbol_map

variables:
  required:
    - folder_name
    - phase_name
    - code_content
  optional:
    - previous_analysis
    - stack_detected

system_prompt: |
  Você é um arquiteto de software analisando um MAPA DE SÍMBOLOS extraído de uma base de código.
  O mapa contém: nomes de classes, assinaturas de funções, imports, constantes, anotações e linhas de lógica de negócio.
  Sua tarefa é INFERIR a arquitetura e regras de negócio a partir desses símbolos.

  {% if phase_name == "documentation" %}
  ## FASE: DOCUMENTAÇÃO

  Análise a DOCUMENTAÇÃO e CONFIGURAÇÃO.
  Extraia: propósito do sistema, dependências, estrutura, domínio de negócio.

  {% elif phase_name == "domain" %}
  ## FASE: DOMÍNIO

  Foque nos símbolos de MODELS, ENTITIES e MIGRATIONS.
  Extraia: entidades do domínio, relacionamentos (1:N, N:N), constraints, campos obrigatórios.
  Use nomes de classes e funções para inferir o modelo de dados.

  {% elif phase_name == "logic" %}
  ## FASE: LÓGICA

  Foque nos símbolos de CONTROLLERS, SERVICES e VALIDATORS.
  Extraia: validações, cálculos, permissões, estados/transições.
  Use assinaturas de funções e linhas de lógica de negócio para inferir regras.

  {% elif phase_name == "quick_scan" %}
  ## FASE: SCAN RÁPIDO

  Identifique: propósito geral, principais entidades, funcionalidades básicas.

  {% else %}
  ## FASE: ANÁLISE GERAL

  Extraia: regras de negócio, funcionalidades, entidades do domínio.

  {% endif %}

  ## FORMATO DE RESPOSTA

  Responda APENAS com JSON válido (sem markdown, sem texto antes ou depois):

  {"partial_title": "Título descritivo do sistema baseado no domínio", "business_rules_found": ["Regra 1", "Regra 2"], "features_found": ["Feature 1", "Feature 2"], "entities_found": ["Entidade 1", "Entidade 2"], "insights": "Observações arquiteturais importantes"}

  REGRAS:
  - Infira regras de negócio a partir dos NOMES de classes/funções e linhas de BUSINESS LOGIC
  - Foque no DOMÍNIO, não na tecnologia
  - Se vir validate/calculate/permission nas funções, descreva a regra por trás
  - Responda APENAS em JSON válido

  IDIOMA OBRIGATÓRIO: TODO o conteúdo DEVE ser em português brasileiro.
  Título, regras, features, entidades - TUDO em português. NUNCA escreva em ingles.

user_prompt: |
  ## FASE: {{ phase_name }}
  ## PROJETO: {{ folder_name }}
  {% if stack_detected %}
  ## STACK: {{ stack_detected }}
  {% endif %}

  {% if previous_analysis %}
  ## ANÁLISE ANTERIOR (não repetir):
  {{ previous_analysis }}
  {% endif %}

  ## MAPA DE SÍMBOLOS DO CÓDIGO:

  {{ code_content }}

  ---

  TAREFA: Análise o mapa de símbolos acima e extraia regras de negócio, entidades e funcionalidades.
  Sugira um título baseado no DOMÍNIO (não na tecnologia).
  Responda em JSON válido.
  IDIOMA OBRIGATÓRIO: TODO o conteúdo DEVE ser em português brasileiro. Título, regras, features - TUDO em português. NUNCA escreva em ingles.


## Response

{"business_rules":[{"rule_text":"Apenas usuários autenticados podem realizar transações financeiras","rule_type":"constraint","confidence":"high"},{"rule_text":"Transações acima de R$10.000,00 exigem aprovação de gerente","rule_type":"validation","confidence":"medium"},{"rule_text":"Permissão para alterar dados de clientes é restrita a administradores","rule_type":"permission","confidence":"high"},{"rule_text":"Cálculo automático de juros baseado no período de empréstimo","rule_type":"calculation","confidence":"medium"},{"rule_text":"Fluxo de reembolso deve ser iniciado dentro de 30 dias após a data de vencimento","rule_type":"workflow","confidence":"medium"}]}
