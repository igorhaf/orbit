"""
Prompt constants for discovery domain.
Auto-generated from YAML files in backend/app/prompts/discovery/
"""

# ---------------------------------------------------------------------------
# discovery/business_section.yaml
# ---------------------------------------------------------------------------

BUSINESS_SECTION_SYSTEM = """INFORMAÇÕES DO PROJETO:
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
"""

BUSINESS_SECTION_USER = """"""

# ---------------------------------------------------------------------------
# discovery/pattern_discovery.yaml
# ---------------------------------------------------------------------------

PATTERN_DISCOVERY_SYSTEM = """"""

PATTERN_DISCOVERY_USER = """Você esta analisando um codebase para descobrir padrões de código repetitivos.

Estou mostrando {{ sampled_files_count }} arquivos de amostra de um grupo de {{ file_count }} arquivos similares.

Informações do Grupo:
- Extensão: {{ extension }}
- Categoria Estimada: {{ estimated_category }}
- Total de Arquivos: {{ file_count }}

Arquivos de Amostra:
{{ files_text }}

Sua Tarefa:
1. Determine se existe um **padrão repetitivo significativo** entre estes arquivos
2. Se sim, extraia um **template** com {{Placeholders}} para as partes variaveis
3. Sugira uma **categoria** e um **nome** para este padrão
4. Avalie sua **confianca** (0.0 a 1.0)

Responda APENAS com JSON (sem blocos markdown):
{
  "pattern_found": true/false,
  "category": "categoria sugerida (ex: 'api', 'model', 'service', 'component')",
  "name": "nome sugerido (ex: 'fastapi_router', 'react_component', 'sqlalchemy_model')",
  "spec_type": "tipo específico (ex: 'rest_api', 'database_model', 'ui_component')",
  "title": "Título legivel",
  "description": "O que este padrão representa (2-3 frases)",
  "template": "Template de código com {{Placeholders}} para partes variaveis",
  "language": "linguagem de programação",
  "confidence": 0.0-1.0,
  "reasoning": "Por que você identificou este padrão (ou por que não)",
  "key_characteristics": ["lista", "de", "caracteristicas", "principais"]
}

Se não existir padrão significativo (arquivos muito diferentes), defina pattern_found: false.

IMPORTANTE: Retorne APENAS JSON válido, sem blocos de código markdown.
"""

# ---------------------------------------------------------------------------
# discovery/convention_extraction.yaml
# ---------------------------------------------------------------------------

CONVENTION_EXTRACTION_SYSTEM = """"""

CONVENTION_EXTRACTION_USER = """Analyze the following code samples from a {{ detected_stack | default('software') }} project and extract the coding conventions used.

{% if detected_stack %}
Detected stack: {{ detected_stack }}
{% endif %}

{{ files_text }}

Please analyze the code and return a JSON object with the following structure:

{
  "naming": {
    "classes": "PascalCase|snake_case|...",
    "methods": "camelCase|snake_case|...",
    "variables": "camelCase|snake_case|...",
    "constants": "UPPER_SNAKE_CASE|...",
    "files": "kebab-case|snake_case|PascalCase|...",
    "database": {"tables": "snake_case|...", "columns": "snake_case|..."}
  },
  "architecture": {
    "pattern": "MVC|Repository|Service Layer|...",
    "uses_repositories": true|false,
    "uses_services": true|false,
    "layered_architecture": true|false
  },
  "code_style": {
    "indentation": "2 spaces|4 spaces|tabs",
    "quotes": "single|double",
    "semicolons": true|false,
    "trailing_commas": true|false
  }
}

Return ONLY the JSON object, no explanations.
"""

# ---------------------------------------------------------------------------
# discovery/pattern_extraction.yaml
# ---------------------------------------------------------------------------

PATTERN_EXTRACTION_SYSTEM = """"""

PATTERN_EXTRACTION_USER = """Analyze the following {{ pattern_type }} files from a {{ detected_stack | default('software') }} project and create a reusable code template.

{% if detected_stack %}
Stack: {{ detected_stack }}
{% endif %}

{{ files_text }}

Your task:
1. Identify the common structure across these examples
2. Create a generic template by replacing specific values with placeholders
3. Use descriptive placeholder names like EntityName, FieldName, table_name, etc.
4. Preserve the overall structure, imports, and code style

Placeholder naming conventions:
- EntityName - PascalCase for class names
- entity_name - snake_case for variables
- entityName - camelCase for methods
- TABLE_NAME - UPPER_SNAKE_CASE for constants
- description - descriptive text

Return ONLY the template code, no explanations. If the code has a language-specific syntax, include it exactly.
"""

# ---------------------------------------------------------------------------
# PROMPTS registry
# ---------------------------------------------------------------------------

PROMPTS = {
    "discovery/business_section": {
        "system": BUSINESS_SECTION_SYSTEM,
        "user": BUSINESS_SECTION_USER,
        "usage_type": "interview",
    },
    "discovery/pattern_discovery": {
        "system": PATTERN_DISCOVERY_SYSTEM,
        "user": PATTERN_DISCOVERY_USER,
        "usage_type": "prompt_generation",
    },
    "discovery/convention_extraction": {
        "system": CONVENTION_EXTRACTION_SYSTEM,
        "user": CONVENTION_EXTRACTION_USER,
        "usage_type": "general",
    },
    "discovery/pattern_extraction": {
        "system": PATTERN_EXTRACTION_SYSTEM,
        "user": PATTERN_EXTRACTION_USER,
        "usage_type": "general",
    },
}
