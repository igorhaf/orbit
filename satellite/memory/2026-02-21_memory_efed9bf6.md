# memory — 2026-02-21

**Model:** ollama/qwen3:8b
**Status:** success
**Tokens:** 1998 in / 1109 out | Cost: $0.0075

## System Prompt

Voce e um analista de negocios. Extraia APENAS regras de NEGOCIO FUNCIONAIS do codigo. FOQUE em: o que o USUARIO pode fazer, permissoes, fluxos, limites, calculos de negocio. IGNORE completamente: tipos de campo, configs de framework, drivers, sessoes, CSS, logs, booleanos, chaves estrangeiras, detalhes tecnicos de infraestrutura. Escreva cada regra como se explicasse para um GERENTE DE PRODUTO, nao para um programador. Responda APENAS com JSON valido, em portugues brasileiro: {"business_rules":[{"rule_text":"...","rule_type":"validation|workflow|constraint|domain","confidence":"high|medium"}]}

## User Prompt

backend/app/prompts/discovery/business_section.yaml (yaml):
# Prompt: Business Rules Interview Section
# Source: context_builders.py:140-200
# PROMPT #94 - Specialized sections in orchestrator mode

name: business_section
version: 1
category: discovery
description: Entrevista focada em regras de negócio e lógica de domínio
usage_type: interview
estimated_tokens: 1500
tags:
  - interview
  - business
  - rules
  - domain

variables:
  required:
    - project_name
    - project_description
    - question_num
  optional: []

components: []

system_prompt: |
  INFORMAÇÕES DO PROJETO:
  - Nome: {{ project_name }}
  - Descrição: {{ project_description }}

  **SECAO ESPECIALIZADA: NEGOCIO - Regras de Negocio**

  Você esta na fase de perguntas sobre **REGRAS DE NEGOCIO** e **LÓGICA DE DOMINIO**.

  **FOCO DESTA SECAO (não pergunte tudo de uma vez):**
  1. **Regras de Validação**: Quais validacoes de negocio? (ex: ID único, idade mínima, limite de credito)
  2. **Workflows**: Sequências/passos obrigatorios? (ex: pedido -> pagamento -> envio)
  3. **Permissoes e Acesso**: Quem pode fazer o que? Níveis de acesso?
  4. **Calculos e Formulas**: Regras de calculo? (ex: desconto, frete, impostos, comissao)
  5. **Estados e Transicoes**: Quais status? Transicoes permitidas? (ex: rascunho -> publicado -> arquivado)
  6. **Integracoes de Negocio**: APIs externas necessarias? (pagamento, frete, email, SMS)
  7. **Dados Criticos**: Entidades principais? Relacionamentos? (ex: Usuário -> Pedido -> Produto)

  **FORMATO DA PERGUNTA:**
  Pergunta {{ question_num }}: [Sua pergunta focada em REGRAS DE NEGOCIO]

  Para ESCOLHA ÚNICA:
  - Opcao 1
  - Opcao 2
  - Opcao 3

  Para MULTIPLA ESCOLHA:
  - Opcao 1
  - Opcao 2
  - Opcao 3
  [Selecione todas que se aplicam]

  **REGRAS:**
  - Uma pergunta por vez, FOCADA em regras de negocio
  - Construa contexto com respostas anteriores
  - Sempre forneca opcoes (nunca perguntas abertas!)
  - Apos 4-6 perguntas de negocio, passe para a próxima secao

  **EXEMPLOS DE BOAS PERGUNTAS:**

  BOM (Validação de negocio):
  Quais validacoes devem ser aplicadas ao criar um novo usuário?

  - Email único (não pode repetir)
  - CPF/CNPJ válido
  - Idade mínima (ex: 18 anos)
  - Telefone obrigatório
  - Senha forte (mínimo 8 caracteres)

  Selecione todas que se aplicam.

  BOM (Workflow):
  Qual o fluxo de status de um pedido?

  - Simples: pendente -> pago -> entregue
  - Completo: pendente -> confirmado -> pago -> em separação -> enviado -> entregue
  - Complexo: pendente -> em análise -> aprovado -> pago -> em produção -> enviado -> entregue
  - Customizado (especificar depois)

  **IDIOMA DE SAÍDA: Português (Brasil).** Continue com a próxima pergunta relevante sobre REGRAS DE NEGOCIO!

  ## REGRA GERAL
  - NUNCA use emojis ou símbolos especiais nas respostas

user_prompt: ""


## Response

{
  "business_rules": [
    {
      "rule_text": "O usuário deve fornecer um email único ao criar uma conta.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O CPF ou CNPJ do usuário deve ser válido conforme padrões oficiais.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário deve ter idade mínima de 18 anos para se cadastrar.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário deve informar um número de telefone válido ao se cadastrar.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "A senha do usuário deve ter no mínimo 8 caracteres e seguir padrões de segurança.",
      "rule_type": "validation",
      "confidence": "high"
    },
    {
      "rule_text": "O fluxo de status de um pedido deve seguir a sequência: pendente -> pago -> entregue.",
      "rule_type": "workflow",
      "confidence": "high"
    },
    {
      "rule_text": "Somente usuários com permissão específica podem alterar o status de um pedido para 'entregue'.",
      "rule_type": "constraint",
      "confidence": "high"
    },
    {
      "rule_text": "O sistema deve calcular descontos, frete, impostos e comissão com base em regras pré-definidas.",
      "rule_type": "domain",
      "confidence": "high"
    },
    {
      "rule_text": "O usuário só pode alterar o status de um pedido para 'publicado' após aprovação da revisão.",
      "rule_type": "constraint",
      "confidence": "medium"
    },
    {
      "rule_text": "Integrações com APIs de pagamento, frete e notificação são obrigatórias para processar transações.",
      "rule_type": "integration",
      "confidence": "medium"
    }
  ]
}
