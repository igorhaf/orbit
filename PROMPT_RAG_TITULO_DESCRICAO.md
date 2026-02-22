# Geração de Título e Descrição — Prompt RAG Phase 3 (Project Metadata)

## Objetivo

A partir das regras de negócio extraídas do projeto e armazenadas no RAG, gerar um título conciso e uma descrição detalhada para o projeto. Estes metadados são usados para identificar e contextualizar o projeto em toda a interface do sistema.

**REGRA #0 — DADOS HUMANOS SÃO SAGRADOS**: Este prompt SÓ gera título e descrição se os campos estiverem VAZIOS. Se o usuário já preencheu esses campos manualmente, os dados humanos são preservados e o output da IA é DESCARTADO.

## Escopo

### Entrada:
- Regras de negócio do RAG (extraídas na Phase 2)
- Código-fonte indexado no RAG (Phase 1)
- Estado atual do projeto (nome e descrição existentes)

### Saída:
- Título conciso do projeto (se campo vazio)
- Descrição detalhada do projeto (se campo vazio)

### Restrição fundamental:
- Se `project.name` já tem valor → título gerado é DESCARTADO
- Se `project.description` já tem valor → descrição gerada é DESCARTADA
- A IA **NUNCA** sobrescreve dados editados por humano

## Instruções

1. Analise as regras de negócio e o código-fonte do projeto na base de conhecimento.

2. Identifique:
   - **Propósito** do sistema (o que faz, qual problema resolve)
   - **Stack tecnológica** principal (linguagens, frameworks, bancos de dados)
   - **Arquitetura** geral (monolito, microserviços, serverless)
   - **Público-alvo** (desenvolvedores, usuários finais, admins)

3. Gere um **título** que capture a essência do projeto em poucas palavras.

4. Gere uma **descrição** que cubra propósito, stack, arquitetura e público-alvo.

5. Responda em JSON puro seguindo o contrato abaixo.

## Contrato JSON (Schema Rígido)

Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicações.

```json
{
  "project": {
    "title": "string — 5-120 chars, título conciso sem quebras de linha",
    "description": "string — 50-2000 chars, descrição detalhada: propósito, stack, arquitetura, público-alvo"
  }
}
```

## Campos Detalhados

### title (5-120 chars)

**O que incluir:**
- Nome do sistema/produto
- Propósito em poucas palavras
- Sem quebras de linha

**Exemplos bons:**
- "ORBIT — Sistema de Orquestração de IA para Desenvolvimento"
- "TaskFlow — Gestão Inteligente de Projetos com IA"
- "MedTrack — Plataforma de Rastreamento de Medicamentos"

**Exemplos ruins (rejeitados):**
- "Projeto" (muito vago, < 5 chars)
- "Sistema..." (sem informação útil)
- Títulos com mais de 120 caracteres

### description (50-2000 chars)

**Estrutura recomendada:**
1. **Propósito** (1-2 frases): o que o sistema faz e qual problema resolve
2. **Stack** (1 frase): tecnologias principais usadas
3. **Arquitetura** (1 frase): como o sistema é organizado
4. **Diferencial** (1 frase): o que torna o sistema único

**Exemplo bom:**
> "O ORBIT é um sistema de orquestração de inteligência artificial que gerencia múltiplos modelos de IA (Claude, GPT-4, Gemini) para automatizar tarefas de desenvolvimento de software. Construído com FastAPI no backend e Next.js 14 no frontend, utiliza PostgreSQL com RAG (Retrieval-Augmented Generation) para análise contextual de codebases. A arquitetura multi-provider permite fallback automático entre modelos, otimizando custo e qualidade das respostas. O sistema analisa projetos existentes, extrai regras de negócio, gera hierarquia de cards de trabalho e documentação técnica automaticamente."

## Regras de Validação

| Campo | Validação | Se inválido |
|-------|-----------|-------------|
| `title` | 5-120 chars | REJEITADO |
| `title` | sem quebras de linha (\n, \r) | Quebras removidas automaticamente |
| `description` | 50-2000 chars (relaxado: aceita ≥20 chars) | REJEITADO se < 20 chars |
| `description` | max 2000 chars | Truncado |
| REGRA #0 | `project.name` já preenchido | Título DESCARTADO (não sobrescreve) |
| REGRA #0 | `project.description` já preenchido | Descrição DESCARTADA (não sobrescreve) |

## Lógica de Aplicação (REGRA #0)

```python
# Como o sistema aplica o resultado:

# Título: SÓ seta se campo vazio
if ai_title and 5 <= len(ai_title) <= 120:
    if not (project.name and project.name.strip()):
        project.name = ai_title  # ✅ Campo vazio, pode preencher
    # Se project.name já tem valor → ai_title é IGNORADO

# Descrição: SÓ seta se campo vazio
if ai_desc and len(ai_desc) >= 20:
    if not (project.description and project.description.strip()):
        project.description = ai_desc[:2000]  # ✅ Campo vazio, pode preencher
    # Se project.description já tem valor → ai_desc é IGNORADO
```

## Exemplo de Saída

```json
{
  "project": {
    "title": "ORBIT — Orquestrador de IA para Análise de Projetos",
    "description": "O ORBIT é uma plataforma de orquestração de inteligência artificial projetada para automatizar a análise e documentação de projetos de software existentes. O sistema utiliza FastAPI como backend, Next.js 14 com App Router no frontend, PostgreSQL como banco de dados principal e Redis para cache. Através de um pipeline RAG (Retrieval-Augmented Generation) de 4 fases, o ORBIT indexa o código-fonte, extrai regras de negócio, gera hierarquias de cards de trabalho (Epic > Story > Task > Subtask) e produz documentação wiki técnica completa. O diferencial está na orquestração multi-provider (Anthropic Claude, OpenAI GPT, Google Gemini) com fallback automático e otimização de custos por modelo."
  }
}
```

## Notas Importantes

- Todos os textos DEVEM ser em **PORTUGUÊS**
- O título deve ser **conciso mas informativo** — capture a essência em poucas palavras
- A descrição deve ser **detalhada e factual** — baseada no código real
- **NUNCA** invente tecnologias ou features que não existem no projeto
- **REGRA #0** é inviolável: dados humanos NUNCA são sobrescritos
- Se ambos os campos já estiverem preenchidos, este prompt é efetivamente um **no-op**
- O campo `project` no JSON unificado pode ser omitido nas passadas de reforço (passes 2 e 3)
