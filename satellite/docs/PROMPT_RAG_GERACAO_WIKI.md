# Geração de Wiki — Prompt RAG Phase 3 (Wiki)

## Objetivo

A partir das regras de negócio extraídas do projeto e armazenadas no RAG, gerar páginas wiki técnicas completas que documentem o sistema de forma abrangente e factual. As páginas devem cobrir arquitetura, regras de negócio, API, modelos de dados e guias de desenvolvimento.

## Escopo

### Entrada:
- Regras de negócio do RAG (extraídas na Phase 2)
- Código-fonte indexado no RAG (Phase 1)
- Contexto do projeto (nome, stack, estrutura)

### Saída:
- Conjunto de páginas wiki em Markdown com conteúdo técnico rico
- Cada página armazenada no filesystem e indexada no RAG

### Cobertura esperada:
- Documentação completa do sistema
- Cada domínio/módulo documentado
- Exemplos de código reais (não inventados)
- Diagramas e tabelas quando útil

## Instruções

1. Analise todas as regras de negócio e código-fonte disponíveis na base de conhecimento.

2. Gere as **7 páginas obrigatórias** (veja lista abaixo), cada uma com conteúdo rico e detalhado.

3. Adicione páginas extras para módulos/domínios específicos que mereçam documentação própria.

4. Para cada página:
   - **slug**: identificador único em kebab-case
   - **title**: título descritivo em português
   - **content**: Markdown rico com headers, listas, tabelas e código (mínimo 1000 chars)
   - **order**: posição sequencial (1, 2, 3...)

5. Use conteúdo **factual** baseado no código real — NÃO invente features que não existem.

6. Seja EXTENSO e DETALHADO — páginas curtas serão descartadas.

## Contrato JSON (Schema Rígido)

Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicações.

```json
{
  "wiki_pages": [
    {
      "slug": "string — kebab-case, 3-80 chars, único (ex: autenticacao-usuarios)",
      "title": "string — 3-200 chars, título descritivo em português",
      "content": "string — Markdown com min 1000 chars, headers ##/###, listas, tabelas, código",
      "order": "integer — posição sequencial única (1, 2, 3...)"
    }
  ]
}
```

## Páginas Obrigatórias

Estas 7 páginas DEVEM ser geradas (mesmo que o projeto tenha informação limitada):

| # | Slug | Título Sugerido | Conteúdo Esperado |
|---|------|----------------|-------------------|
| 1 | `visao-geral` | Visão Geral do Projeto | Propósito, stack, público-alvo, diagrama de alto nível |
| 2 | `arquitetura` | Arquitetura do Sistema | Padrões arquiteturais, camadas, fluxo de dados, decisões técnicas |
| 3 | `regras-negocio` | Regras de Negócio | Todas as regras agrupadas por domínio, com exemplos |
| 4 | `api-endpoints` | API e Endpoints | Lista de endpoints com método, rota, parâmetros, responses |
| 5 | `modelos-dados` | Modelos de Dados | Entidades, campos, relacionamentos, constraints |
| 6 | `autenticacao` | Autenticação e Autorização | Fluxo de auth, tokens, roles, permissões |
| 7 | `guia-desenvolvimento` | Guia de Desenvolvimento | Setup, convenções, padrões de código, como contribuir |

## Estrutura de Conteúdo por Página

Cada página deve conter, no mínimo:

### Headers (##, ###)
```markdown
## Seção Principal
### Sub-seção detalhada
```

### Listas
```markdown
- Item descritivo com explicação
- Outro item com contexto adicional
  - Sub-item se necessário
```

### Tabelas
```markdown
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Identificador único |
| name | String(255) | Nome do recurso |
```

### Blocos de Código
````markdown
```python
# Exemplo real do código do projeto
def create_user(self, data: UserCreate) -> User:
    ...
```
````

### Parágrafos Detalhados
- Explicações completas de como cada parte funciona
- Contexto técnico e de negócio
- Referências cruzadas entre seções

## Regras de Validação

| Campo | Validação | Se inválido |
|-------|-----------|-------------|
| `slug` | kebab-case, 3-80 chars, regex: `^[a-z0-9]+(-[a-z0-9]+)*$` | Auto-fix (espaços→hífens) ou REJEITADO |
| `slug` | único (sem duplicatas) | Duplicata REJEITADA |
| `title` | 3-200 chars | Se < 3: gerado automaticamente do slug |
| `title` | max 200 chars | Truncado |
| `content` | min 500 chars de Markdown (prompt pede 1000) | REJEITADO se < 500 chars |
| `order` | inteiro sequencial | Coerced para int, default 1 |

## Exemplo de Saída

```json
{
  "wiki_pages": [
    {
      "slug": "visao-geral",
      "title": "Visão Geral do Projeto",
      "content": "## Visão Geral\n\nO ORBIT é um sistema de orquestração de IA que gerencia múltiplos modelos de inteligência artificial para diferentes tipos de tarefas de desenvolvimento de software.\n\n### Propósito\n\nO sistema foi criado para automatizar e otimizar o ciclo de desenvolvimento, desde a análise de código existente até a geração de documentação e cards de trabalho.\n\n### Stack Tecnológica\n\n| Camada | Tecnologia | Versão |\n|--------|-----------|--------|\n| Backend | FastAPI | 0.100+ |\n| Frontend | Next.js 14 | App Router |\n| Banco de Dados | PostgreSQL | 15+ |\n| Cache | Redis | 7+ |\n| IA | Claude, GPT-4, Gemini | Multi-provider |\n\n### Arquitetura de Alto Nível\n\n```\nFrontend (Next.js) → API (FastAPI) → AI Orchestrator → Providers (Claude/GPT/Gemini)\n                                    ↓\n                              PostgreSQL + Redis + RAG\n```\n\n### Módulos Principais\n\n- **Gestão de Projetos**: CRUD de projetos com análise automática de codebase\n- **RAG Pipeline**: Extração de regras, geração de cards e wiki\n- **AI Flow**: Configuração visual de chains de fallback entre modelos\n- **Entrevistas**: Sistema de entrevistas IA para coleta de requisitos\n- **Backlog**: Hierarquia de cards com Kanban e priorização\n\n### Público-Alvo\n\nDesenvolvedores e Product Owners que desejam automatizar a análise e documentação de projetos de software existentes.",
      "order": 1
    },
    {
      "slug": "regras-negocio",
      "title": "Regras de Negócio",
      "content": "## Regras de Negócio do Sistema\n\nEste documento consolida todas as regras de negócio identificadas no código-fonte do projeto, agrupadas por domínio.\n\n### Domínio: Autenticação\n\n| ID | Regra | Prioridade | Arquivo |\n|----|-------|------------|--------|\n| RN-001 | Email deve ser único no sistema | Critical | models/user.py |\n| RN-002 | Senha mínima de 8 caracteres | High | schemas/user.py |\n| RN-003 | Token JWT expira em 15 minutos | High | services/auth.py |\n\n#### RN-001: Email Único\n\nO sistema impede a criação de usuários com email duplicado. A validação ocorre em duas camadas:\n\n1. **Model layer**: Constraint `UNIQUE` no campo `email` da tabela `users`\n2. **Service layer**: Verificação prévia antes do INSERT\n\n```python\n# backend/app/models/user.py\nemail = Column(String(255), unique=True, nullable=False)\n```\n\n### Domínio: Projetos\n\n| ID | Regra | Prioridade | Arquivo |\n|----|-------|------------|--------|\n| RN-010 | Projeto deve ter code_path válido | Critical | schemas/project.py |\n| RN-011 | Dados humanos nunca sobrescritos por IA | Critical | REGRA #0 |\n\n#### RN-011: Supremacia de Dados Humanos (REGRA #0)\n\nDados inseridos ou editados por um operador humano têm **prioridade absoluta** sobre dados gerados por IA. Se um humano editou um campo (título, descrição, status), a IA NÃO pode sobrescrever.\n\n```python\n# Verificação obrigatória antes de qualquer update por IA\nif not (project.name and project.name.strip()):\n    project.name = ai_generated_title  # OK: campo vazio\n```",
      "order": 3
    }
  ]
}
```

## Notas Importantes

- Todos os textos DEVEM ser em **PORTUGUÊS**
- Conteúdo deve ser **factual** — baseado no código real, não inventado
- PREFIRA páginas **extensas e detalhadas** a páginas curtas e superficiais
- Idealmente **1000-5000 caracteres** por página
- Páginas com menos de **500 caracteres** serão **DESCARTADAS**
- Use referências cruzadas entre páginas quando relevante
- Blocos de código devem ser de código **real** do projeto
- Wiki é armazenada em `satellite/knowledge/wiki/{slug}.md` com YAML front matter
- Cada página também é indexada no RAG com metadata `{"type": "wiki_page"}`
