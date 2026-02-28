# Extração de Regras de Negócio — Prompt RAG Phase 2

## Objetivo

Extrair todas as regras de negócio funcionais presentes no código-fonte do projeto e inseri-las no sistema RAG (Retrieval-Augmented Generation) para uso posterior na geração de cards e wiki.

## Escopo

### Onde procurar:
- Modelos de domínio (models, entities, schemas)
- Serviços e casos de uso (services, use cases, handlers)
- Validações (validators, middleware, guards)
- Rotas e controllers (routes, endpoints, controllers)
- Testes unitários e de integração (comportamentos esperados)
- Documentação existente (README, docs/, comentários relevantes)

### O que procurar:
- Comentários com termos: "Regra de negócio:", "RN:", "Business rule:", "funcionalidade:", "condição:", "validação:"
- Lógica condicional que implementa regras de domínio
- Validações de entrada e restrições de dados
- Workflows e máquinas de estado
- Permissões e controle de acesso
- Cálculos e fórmulas de negócio
- Integrações com serviços externos

### O que ignorar:
- Configurações puras de framework (settings, config boilerplate)
- CSS, estilos, layouts puramente visuais
- Logs de debug, print statements
- Infraestrutura Docker, CI/CD
- Imports e boilerplate de linguagem

## Instruções

1. Explore o código-fonte e a documentação do projeto para identificar trechos que descrevam ou implementem regras de negócio funcionais.

2. Para cada regra encontrada, extraia:
   - **rule_text** — Descrição clara e detalhada da regra em português (mínimo 15 caracteres, ideal 100-500)
   - **rule_type** — Classificação usando EXATAMENTE um dos 8 tipos permitidos
   - **source_file** — Caminho relativo do arquivo onde a regra foi encontrada
   - **priority** — Prioridade da regra usando EXATAMENTE um dos 4 níveis
   - **entity** — Entidade principal relacionada à regra (ex: Usuario, Pedido, Projeto)
   - **evidence** — Trecho de código ou função que comprova a existência da regra

3. Compile todas as regras em JSON puro seguindo o contrato abaixo.

4. Extraia o MÁXIMO de regras possível. Seja minucioso e detalhado.

5. NÃO invente regras — apenas o que EXISTE no código.

## Contrato JSON (Schema Rígido)

Responda APENAS com JSON puro. Sem markdown, sem ```json, sem explicações.

```json
{
  "business_rules": [
    {
      "rule_text": "string — descrição detalhada da regra em português (min 15 chars, max 2000)",
      "rule_type": "dominio | validacao | restricao | workflow | permissao | calculo | integracao | negocio",
      "source_file": "string — caminho relativo do arquivo (ex: backend/app/models/user.py) (min 3 chars)",
      "priority": "critical | high | medium | low",
      "entity": "string — entidade principal (ex: Usuario, Pedido, Projeto) (max 200 chars, opcional)",
      "evidence": "string — trecho de código que comprova a regra (max 1000 chars, opcional)"
    }
  ]
}
```

### Tipos de Regra (rule_type)

| Valor | Descrição | Exemplo |
|-------|-----------|---------|
| `dominio` | Regra do domínio do negócio | "Um pedido só pode ter no máximo 50 itens" |
| `validacao` | Validação de entrada de dados | "Email deve ser único no sistema" |
| `restricao` | Restrição funcional | "Desconto máximo de 15% por venda" |
| `workflow` | Fluxo ou máquina de estado | "Pedido passa por: rascunho → pendente → aprovado → entregue" |
| `permissao` | Controle de acesso | "Apenas admins podem deletar projetos" |
| `calculo` | Fórmula ou cálculo de negócio | "Frete = peso × distância × 0.05" |
| `integracao` | Regra de integração externa | "Pagamento processado via Stripe Webhooks" |
| `negocio` | Regra genérica de negócio | "Projetos inativos há 90 dias são arquivados" |

### Níveis de Prioridade (priority)

| Valor | Descrição |
|-------|-----------|
| `critical` | Regra essencial — sistema quebra sem ela |
| `high` | Regra importante — impacto significativo |
| `medium` | Regra relevante — funcionalidade secundária |
| `low` | Regra menor — edge case ou conveniência |

## Regras de Validação

| Campo | Validação | Se inválido |
|-------|-----------|-------------|
| `rule_text` | min 15 chars | REJEITADO |
| `rule_text` | max 2000 chars | Truncado |
| `rule_type` | deve estar no enum (8 valores) | REJEITADO |
| `source_file` | min 3 chars | REJEITADO |
| `source_file` | max 500 chars | Truncado |
| `priority` | deve estar no enum (4 valores) | REJEITADO (exceção: "normal" → auto-fix para "medium") |
| `entity` | max 200 chars | Truncado |
| `evidence` | max 1000 chars | Truncado |

## Exemplo de Saída

```json
{
  "business_rules": [
    {
      "rule_text": "O sistema impede que um usuário seja criado com email duplicado. A validação ocorre no model User através de unique constraint no campo email e verificação prévia no service de criação.",
      "rule_type": "validacao",
      "source_file": "backend/app/models/user.py",
      "priority": "critical",
      "entity": "Usuario",
      "evidence": "email = Column(String(255), unique=True, nullable=False)"
    },
    {
      "rule_text": "O desconto máximo permitido em uma venda é de 15%. Qualquer valor acima é automaticamente limitado ao teto. Esta regra é aplicada no cálculo final do pedido antes da confirmação.",
      "rule_type": "restricao",
      "source_file": "backend/app/services/order_service.py",
      "priority": "high",
      "entity": "Pedido",
      "evidence": "def apply_discount(self, value): return min(value, self.MAX_DISCOUNT)"
    },
    {
      "rule_text": "Projetos passam por um workflow de estados: draft → active → archived. A transição de active para archived só ocorre automaticamente após 90 dias de inatividade ou manualmente por um admin.",
      "rule_type": "workflow",
      "source_file": "backend/app/services/project_lifecycle.py",
      "priority": "medium",
      "entity": "Projeto",
      "evidence": "VALID_TRANSITIONS = {'draft': ['active'], 'active': ['archived'], 'archived': ['active']}"
    }
  ]
}
```

## Notas Importantes

- Todas as descrições DEVEM ser em **PORTUGUÊS**
- Se nenhuma regra for encontrada, retorne `{"business_rules": []}`
- Cada `source_file` DEVE ser o caminho relativo real do arquivo analisado
- Seja DETALHADO nas descrições (`rule_text`) — quanto mais contexto, melhor
- Considere testes unitários como fonte: eles explicitam comportamentos esperados
- Uma regra pode ter múltiplas evidências — escolha a mais representativa
