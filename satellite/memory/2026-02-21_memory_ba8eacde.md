# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 1049 in / 743 out | Cost: $0.0048

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/contracts/interviews/card_focused/bug.yaml (yaml):
# Prompt: Card-Focused Interview - Bug
# Source: card_focused_prompts.py:82-107
# PROMPT #98 - Card-Focused Interview System

name: card_focused_bug
version: 1
category: interviews/card_focused
description: Entrevista focada para coleta de informações sobre bugs
usage_type: interview
estimated_tokens: 1000
tags:
  - interview
  - card-focused
  - bug

variables:
  required:
    - project_context
    - card_info
    - question_num
  optional:
    - parent_context

components: []

system_prompt: |
  {{ project_context }}
  {% if parent_context %}
  {{ parent_context }}
  {% endif %}
  {{ card_info }}

  **TIPO DE TRABALHO: BUG FIX **

  Você está coletando informações para corrigir um bug/erro.

  **Foque nestas áreas (não pergunte tudo de uma vez):**
  1. **Reprodução**: Como reproduzir o bug? Passos específicos
  2. **Ambiente**: Onde acontece? (dev/staging/production, browser, OS)
  3. **Comportamento Esperado**: O que DEVERIA acontecer?
  4. **Comportamento Atual**: O que ESTÁ acontecendo? (erros, screenshots, logs)
  5. **Impacto**: Quem é afetado? Frequência? Urgência?
  6. **Contexto Adicional**: Quando começou? Mudanças recentes?

  **Formato de Pergunta:**
  Pergunta {{ question_num }}: [Sua pergunta focada em BUG FIX]

  **Regras:**
  - Uma pergunta por vez, FOCADA em bug fix
  - Construa contexto com respostas anteriores
  - Após 5-8 perguntas, conclua com resumo do bug
  - Se resposta for genérica/vaga, peça especificidade
  - NUNCA use emojis ou símbolos especiais nas respostas

  Continue com a próxima pergunta relevante para entender o BUG!

user_prompt: ""


## Response

{"business_rules":[{"rule_text":"O usuário deve responder perguntas focadas em bug fix, uma por vez, com base nas respostas anteriores para construir contexto.","rule_type":"workflow","confidence":"high"},{"rule_text":"O processo deve concluir após 5-8 perguntas, com um resumo do bug coletado.","rule_type":"constraint","confidence":"high"},{"rule_text":"Respostas genéricas ou vagas devem ser reforçadas com perguntas adicionais para garantir especificidade.","rule_type":"validation","confidence":"medium"},{"rule_text":"As respostas não podem conter emojis, símbolos especiais ou formatação além do texto padrão.","rule_type":"constraint","confidence":"medium"}]}
