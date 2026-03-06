"""
Components Contracts - Auto-generated from YAML contracts.
Source: backend/app/contracts/components/ (3 files)
"""


# --- components/json_output_rules.yaml ---

COMPONENTS_JSON_OUTPUT_RULES_SYSTEM = """"""

COMPONENTS_JSON_OUTPUT_RULES_USER = """"""

COMPONENTS_JSON_OUTPUT_RULES_CONTENT = """REGRAS DE OUTPUT JSON:

1. Retorne APENAS JSON válido
2. NÃO inclua markdown code blocks (```json ... ```)
3. NÃO inclua explicações antes ou depois do JSON
4. NÃO inclua comentários dentro do JSON
5. Use aspas duplas para strings (padrão JSON)
6. Escape caracteres especiais corretamente (\\n, \\", \\\\)
7. Não use trailing commas
8. Garanta que arrays e objetos estejam fechados corretamente

FORMATO ESPERADO:
{
    "campo1": "valor",
    "campo2": 123,
    "campo3": ["item1", "item2"],
    "campo4": {
        "subcampo": "valor"
    }
}

ERROS COMUNS A EVITAR:
- ERRADO: ```json { ... } ```
- ERRADO: Aqui está o JSON: { ... }
- ERRADO: { "campo": "valor", } (trailing comma)
- ERRADO: { campo: "valor" } (chave sem aspas)

REGRA GERAL:
- NUNCA use emojis ou símbolos especiais nas respostas"""


# --- components/project_context.yaml ---

COMPONENTS_PROJECT_CONTEXT_SYSTEM = """"""

COMPONENTS_PROJECT_CONTEXT_USER = """"""

COMPONENTS_PROJECT_CONTEXT_CONTENT = """**INFORMAÇÕES DO PROJETO:**
- Nome: {{ project_name }}
{% if project_description %}
- Descrição: {{ project_description }}
{% endif %}
{% if stack_backend %}
- Backend: {{ stack_backend }}
{% endif %}
{% if stack_frontend %}
- Frontend: {{ stack_frontend }}
{% endif %}
{% if stack_database %}
- Database: {{ stack_database }}
{% endif %}
{% if context_human %}

**CONTEXTO DO PROJETO:**
{{ context_human }}
{% endif %}

**REGRA GERAL:**
- NUNCA use emojis ou símbolos especiais nas respostas"""


# --- components/semantic_methodology.yaml ---

COMPONENTS_SEMANTIC_METHODOLOGY_SYSTEM = """"""

COMPONENTS_SEMANTIC_METHODOLOGY_USER = """"""

COMPONENTS_SEMANTIC_METHODOLOGY_CONTENT = """METODOLOGIA DE REFERÊNCIAS SEMÂNTICAS:

Esta metodologia funciona da seguinte forma:

1. O texto principal utiliza **identificadores simbólicos** (ex: N1, N2, P1, E1, D1, S1, C1) como **referências semânticas**
2. Esses identificadores **NÃO são variáveis, exemplos ou placeholders**
3. Cada identificador possui um **significado único e imutável** definido em um **Mapa Semântico**
4. O texto narrativo deve ser interpretado **exclusivamente** com base nessas definições
5. **Não faça inferências** fora do que está explicitamente definido no Mapa Semântico
6. **Não substitua** os identificadores por seus significados no texto
7. Caso haja ambiguidade, ela deve ser apontada, não resolvida automaticamente
8. Caso seja necessário criar novos conceitos, eles devem ser introduzidos como novos identificadores e definidos separadamente

**Categorias de Identificadores:**
- **N** (Nouns/Entidades): N1, N2, N3... = Usuários, sistemas, entidades de domínio
- **P** (Processes/Processos): P1, P2, P3... = Processos de negócio, fluxos, workflows
- **E** (Endpoints): E1, E2, E3... = APIs, rotas, endpoints
- **D** (Data/Dados): D1, D2, D3... = Tabelas, estruturas de dados, schemas
- **S** (Services/Serviços): S1, S2, S3... = Serviços, integrações, bibliotecas
- **C** (Constraints/Critérios): C1, C2, C3... = Regras de negócio, validações, restrições
- **AC** (Acceptance Criteria): AC1, AC2, AC3... = Critérios de aceitação numerados

**Objetivo desta metodologia:**
- Reduzir ambiguidade semântica
- Manter consistência conceitual
- Permitir edição posterior manual do código
- Garantir rastreabilidade entre texto e implementação

**REGRA GERAL:**
- NUNCA use emojis ou símbolos especiais nas respostas"""


CONTRACTS = {
    "components/json_output_rules": {"content": COMPONENTS_JSON_OUTPUT_RULES_CONTENT, "system": COMPONENTS_JSON_OUTPUT_RULES_SYSTEM, "user": COMPONENTS_JSON_OUTPUT_RULES_USER},
    "components/project_context": {"content": COMPONENTS_PROJECT_CONTEXT_CONTENT, "system": COMPONENTS_PROJECT_CONTEXT_SYSTEM, "user": COMPONENTS_PROJECT_CONTEXT_USER},
    "components/semantic_methodology": {"content": COMPONENTS_SEMANTIC_METHODOLOGY_CONTENT, "system": COMPONENTS_SEMANTIC_METHODOLOGY_SYSTEM, "user": COMPONENTS_SEMANTIC_METHODOLOGY_USER},
}
