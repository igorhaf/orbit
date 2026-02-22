# Geração de Cards — Prompt RAG Phase 3 (Cards)

## Objetivo

A partir das regras de negócio extraídas do projeto e armazenadas no RAG, gerar uma hierarquia completa de cards de trabalho (Epic > Story > Task > Subtask) que cubra todas as funcionalidades identificadas.

## Escopo

### Entrada:
- Regras de negócio do RAG (extraídas na Phase 2)
- Contexto do projeto (nome, stack tecnológica, arquitetura)

### Saída:
- Hierarquia de cards representando TODO o trabalho necessário
- Cada card com descrição detalhada, critérios de aceitação, estimativa de pontos e complexidade

### Cobertura esperada:
- TODAS as regras de negócio devem ter pelo menos um card correspondente
- Agrupamento lógico por módulo/domínio em Epics
- Granularidade adequada (Stories funcionais, Tasks técnicas, Subtasks atômicas)

## Instruções

1. Analise todas as regras de negócio disponíveis na base de conhecimento do projeto.

2. Agrupe as regras por módulo/domínio funcional — cada grupo vira um **Epic**.

3. Para cada Epic, crie **Stories** que representem funcionalidades completas do módulo.

4. Para cada Story, crie **Tasks** que representem o trabalho técnico necessário.

5. Opcionalmente, crie **Subtasks** para trabalho atômico dentro de Tasks complexas.

6. Para cada card, preencha TODOS os campos obrigatórios seguindo o contrato JSON abaixo.

7. Estime `story_points` **caso a caso** pela complexidade técnica real — NÃO use valores fixos por tipo.

8. Classifique `complexity` baseado no tipo de trabalho:
   - `low` = CRUD simples, configuração, boilerplate (modelo Haiku)
   - `medium` = lógica de negócio, API, integração (modelo Sonnet)
   - `high` = arquitetura, segurança, performance, decisão crítica (modelo Opus)

## Contrato JSON (Schema Rígido)

Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicações.

```json
{
  "cards": [
    {
      "title": "string — 5-255 chars, único no projeto, sem prefixos numéricos",
      "description": "string — min 200 chars: contexto detalhado, motivação, requisitos técnicos, dependências",
      "item_type": "epic | story | task | subtask",
      "parent_title": "string | null — título EXATO do card pai (null para epics raiz)",
      "story_points": "integer Fibonacci: 1 | 2 | 3 | 5 | 8 | 13",
      "priority": "critical | high | medium | low",
      "complexity": "low | medium | high",
      "labels": ["array", "de", "strings", "lowercase", "kebab-case"],
      "acceptance_criteria": ["critério verificável 1 (min 15 chars)", "critério verificável 2"],
      "entity": "string — entidade de domínio principal (ex: Usuario, Pedido, Projeto)"
    }
  ]
}
```

## Hierarquia Obrigatória

```
Epic (parent_title = null)              → módulo macro do sistema
  └─ Story (parent_title = Epic)        → funcionalidade do módulo
      └─ Task (parent_title = Story)    → trabalho técnico
          └─ Subtask (parent_title = Task) → trabalho atômico
```

### Regras de Parentesco:
- Epic **NUNCA** tem `parent_title` (sempre `null`)
- Story **SEMPRE** tem parent que é Epic
- Task **SEMPRE** tem parent que é Story
- Subtask **SEMPRE** tem parent que é Task
- **PULAR NÍVEIS É INVÁLIDO** (ex: Task filha de Epic = REJEITADO)

### Ordem no JSON:
- Epics PRIMEIRO → depois Stories → depois Tasks → depois Subtasks
- Isso garante que ao processar, os pais já existem antes dos filhos

### Quantidade:
- Cada Epic: **3-8 Stories**
- Cada Story: **2-5 Tasks**
- Subtasks: opcionais, apenas para Tasks complexas

## Campos Detalhados

### title (5-255 chars, único)
- Sem prefixos numéricos (nada de "1.1 - ", "EP01 - ")
- Descritivo e específico (não genérico)
- Único no projeto inteiro

### description (min 200 chars)
- **Contexto**: por que este card existe
- **Motivação**: qual problema resolve
- **Requisitos técnicos**: o que precisa ser implementado
- **Dependências**: o que precisa estar pronto antes
- QUANTO MAIS DETALHE, MELHOR

### item_type
| Valor | Escopo | Exemplo |
|-------|--------|---------|
| `epic` | Módulo macro do sistema | "Gestão de Usuários" |
| `story` | Funcionalidade completa | "Cadastro de Usuários com Validação" |
| `task` | Trabalho técnico | "Implementar endpoint POST /users" |
| `subtask` | Trabalho atômico | "Criar migration para tabela users" |

### story_points (Fibonacci, estimado pela IA)
| Valor | Complexidade | Exemplo |
|-------|-------------|---------|
| 1 | Trivial | Renomear variável, corrigir typo |
| 2 | Simples | Adicionar campo a model, CRUD básico |
| 3 | Pequeno | Novo endpoint com validação simples |
| 5 | Médio | Feature com lógica de negócio |
| 8 | Grande | Integração complexa, refatoração |
| 13 | Muito grande | Módulo novo, decisão arquitetural |

**IMPORTANTE**: Estime caso a caso — NÃO use valores fixos por item_type.

### complexity (mapeia para modelo de IA)
| Valor | Modelo | Quando usar |
|-------|--------|-------------|
| `low` | Haiku | CRUD, config, boilerplate, tarefas repetitivas |
| `medium` | Sonnet | Lógica de negócio, API, validação complexa |
| `high` | Opus | Arquitetura, segurança, performance, decisão crítica |

### labels (max 10, kebab-case)
- Lowercase, separado por hífens: `auth`, `api-rest`, `banco-dados`
- Mínimo 2 chars por label, máximo 50 chars
- Máximo 10 labels por card

### acceptance_criteria (min 2, max 20)
- Cada critério: mínimo 15 chars, máximo 2000 chars
- Critérios verificáveis e testáveis
- Formato: frase afirmativa ("O sistema deve...", "O endpoint retorna...")

## Regras de Validação

| Campo | Validação | Se inválido |
|-------|-----------|-------------|
| `title` | 5-255 chars | REJEITADO |
| `description` | min 50 chars | REJEITADO |
| `item_type` | enum (4 valores) | REJEITADO |
| `story_points` | Fibonacci (1,2,3,5,8,13) | Arredondado para o Fibonacci mais próximo |
| `priority` | enum (4 valores) | Auto-fix para "medium" |
| `complexity` | enum (3 valores) | Default inteligente: epic=high, story=medium, task=medium, subtask=low |
| `labels` | array de strings, kebab-case | Normalizado, limitado a 10 |
| `acceptance_criteria` | array, cada item min 10 chars | Itens curtos descartados, max 20 itens |
| `parent_title` | deve referenciar card existente | Aviso de órfão no log |
| Hierarquia | Story→Epic, Task→Story, Subtask→Task | Aviso mas vinculado mesmo assim |

## Exemplo de Saída

```json
{
  "cards": [
    {
      "title": "Gestão de Autenticação e Autorização",
      "description": "Epic que engloba todo o módulo de autenticação do sistema, incluindo login, registro, recuperação de senha, controle de sessões e gestão de permissões por role. Este módulo é fundamental para a segurança do sistema e deve seguir as melhores práticas de OAuth 2.0 e JWT.",
      "item_type": "epic",
      "parent_title": null,
      "story_points": 13,
      "priority": "critical",
      "complexity": "high",
      "labels": ["autenticacao", "seguranca", "backend"],
      "acceptance_criteria": [
        "Sistema de autenticação completo com login, registro e recuperação de senha",
        "Controle de acesso baseado em roles (admin, user, guest)",
        "Tokens JWT com refresh token e expiração configurável",
        "Auditoria de logins com registro de IP e user-agent"
      ],
      "entity": "Usuario"
    },
    {
      "title": "Implementar Login com JWT",
      "description": "Story para implementar o fluxo completo de login usando JWT. O usuário envia email e senha, o sistema valida as credenciais contra o banco de dados, gera um access token (15min) e refresh token (7 dias), e retorna ambos. Senhas são verificadas com bcrypt. Login com credenciais inválidas retorna 401 sem revelar qual campo está errado.",
      "item_type": "story",
      "parent_title": "Gestão de Autenticação e Autorização",
      "story_points": 8,
      "priority": "critical",
      "complexity": "medium",
      "labels": ["autenticacao", "jwt", "api-rest"],
      "acceptance_criteria": [
        "Endpoint POST /auth/login aceita email e senha",
        "Retorna access_token (15min) e refresh_token (7 dias) em caso de sucesso",
        "Retorna 401 com mensagem genérica em caso de credenciais inválidas",
        "Senhas verificadas com bcrypt, nunca armazenadas em texto plano",
        "Rate limiting de 5 tentativas por minuto por IP"
      ],
      "entity": "Usuario"
    },
    {
      "title": "Criar endpoint POST /auth/login",
      "description": "Task técnica para implementar o endpoint de login. Criar o router com FastAPI, schema Pydantic para request/response, service de autenticação que valida credenciais no banco, geração de JWT com PyJWT, e middleware de rate limiting. O endpoint deve logar tentativas de login (sucesso e falha) para auditoria.",
      "item_type": "task",
      "parent_title": "Implementar Login com JWT",
      "story_points": 5,
      "priority": "critical",
      "complexity": "medium",
      "labels": ["api-rest", "fastapi", "jwt"],
      "acceptance_criteria": [
        "Router registrado em /auth/login com método POST",
        "Schema AuthLoginRequest com email (str) e password (str)",
        "Schema AuthLoginResponse com access_token e refresh_token",
        "Service valida credenciais com bcrypt.checkpw()",
        "JWT gerado com payload: sub, exp, iat, role"
      ],
      "entity": "Usuario"
    }
  ]
}
```

## Notas Importantes

- Todos os textos DEVEM ser em **PORTUGUÊS**
- Cubra TODAS as regras de negócio com cards correspondentes
- Cards são criados com `workflow_state="done"` (cards de referência/documentação)
- Cards são identificados por `reporter="pipeline_phase3"` no banco
- NÃO crie cards para infraestrutura pura (Docker, CI/CD) — foque no domínio
- PREFIRA cards detalhados e ricos a cards superficiais
