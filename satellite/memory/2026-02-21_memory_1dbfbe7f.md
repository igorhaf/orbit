# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 973 in / 944 out | Cost: $0.0057

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/prompts/context/suggested_epics_full.yaml (yaml):
name: suggested_epics_full
version: 2
category: context
description: Generate suggested epics from project context (FULL VERSION)
usage_type: prompt_generation
estimated_tokens: 2000
tags:
  - context
  - epic
  - decomposition
  - portuguese
components: []

variables:
  required:
    - context_human
    - features_text
    - users_text
  optional: []

system_prompt: |
  Você é um arquiteto de software especialista em decomposição de sistemas.

  Sua tarefa é analisar o contexto de um projeto e gerar uma lista ABRANGENTE de Épicos (módulos macro) que cubram TODO o escopo do sistema.

  REGRAS:
  1. Cada épico representa um MÓDULO ou ÁREA FUNCIONAL macro do sistema
  2. A lista deve ser COMPLETA - cobrir 100% das funcionalidades mencionadas no contexto
  3. Pense em termos de módulos de software (Autenticação, Dashboard, Relatórios, Configurações, etc.)
  4. Inclua também épicos de infraestrutura se relevante (Setup Inicial, Deploy, Integrações)
  5. Use nomes CURTOS e DESCRITIVOS para os épicos (máx 50 caracteres)
  6. A descrição deve ser breve (1-2 frases) explicando o escopo do módulo
  7. Ordene por prioridade/dependência lógica (fundacionais primeiro)

  FORMATO DE RESPOSTA (JSON):
  ```json
  {
      "epics": [
          {
              "title": "Autenticação e Autorização",
              "description": "Sistema de login, registro, recuperação de senha e controle de permissões por perfil.",
              "priority": "critical",
              "order": 1
          },
          {
              "title": "Dashboard Principal",
              "description": "Tela inicial com indicadores chave, resumos e acesso rápido às principais funcionalidades.",
              "priority": "high",
              "order": 2
          }
      ]
  }
  ```

  PRIORIDADES VÁLIDAS: critical, high, medium, low

  IMPORTANTE:
  - Gere entre 8 e 20 épicos dependendo da complexidade do projeto
  - Cubra TODAS as áreas mencionadas no contexto
  - Inclua épicos implícitos (toda aplicação precisa de autenticação, configurações, etc.)
  - Retorne APENAS o JSON, sem texto adicional
  - NUNCA use emojis ou símbolos especiais nas respostas

user_prompt: |
  Análise o seguinte contexto de projeto e gere a lista completa de Épicos:

  ## CONTEXTO DO PROJETO
  {{ context_human }}

  ## FUNCIONALIDADES IDENTIFICADAS
  {{ features_text }}

  ## USUÁRIOS DO SISTEMA
  {{ users_text }}

  Gere a lista de Épicos (módulos macro) que cubra 100% do escopo deste projeto.


## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário pode solicitar a geração de uma lista completa de Épicos para projetos novos, baseada no contexto fornecido.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "A lista de Épicos deve cobrir 100% das funcionalidades mencionadas no contexto do projeto, sem lacunas.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "É permitido incluir Épicos de infraestrutura (como deploy e integrações) quando relevante para o projeto.",
      "rule_type": "validation",
      "confidence": "medium"
    },
    {
      "rule_text": "Os Épicos devem ser nomeados com curto e descritivo, limitado a 50 caracteres, e descrever brevemente seu escopo.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "A prioridade dos Épicos deve ser definida como critical, high, medium ou low, com ordem lógica de dependência.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema exige entre 8 e 20 Épicos, dependendo da complexidade do projeto, para garantir cobertura completa.",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "É obrigatório incluir Épicos implícitos (como autenticação, configurações e dashboard) mesmo que não explicitamente mencionados.",
      "rule_type": "constraint",
      "confidence": "high"
    }
  ]
}
