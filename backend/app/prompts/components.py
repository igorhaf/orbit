"""
Reusable prompt components — shared text blocks used across multiple prompts.

These constants are injected into prompts via Jinja2 as {{ components.<name> }}.
"""

# ---------------------------------------------------------------------------
# SEMANTIC METHODOLOGY (PROMPT #83)
# Used in: backlog generation, context generation, card activation
# ---------------------------------------------------------------------------
SEMANTIC_METHODOLOGY = """\
METODOLOGIA DE REFERENCIAS SEMANTICAS:

Esta metodologia funciona da seguinte forma:

1. O texto principal utiliza **identificadores simbolicos** (ex: N1, N2, P1, E1, D1, S1, C1) como **referencias semanticas**
2. Esses identificadores **NAO sao variaveis, exemplos ou placeholders**
3. Cada identificador possui um **significado unico e imutavel** definido em um **Mapa Semantico**
4. O texto narrativo deve ser interpretado **exclusivamente** com base nessas definicoes
5. **Nao faca inferencias** fora do que esta explicitamente definido no Mapa Semantico
6. **Nao substitua** os identificadores por seus significados no texto
7. Caso haja ambiguidade, ela deve ser apontada, nao resolvida automaticamente
8. Caso seja necessario criar novos conceitos, eles devem ser introduzidos como novos identificadores e definidos separadamente

**Categorias de Identificadores:**
- **N** (Nouns/Entidades): N1, N2, N3... = Usuarios, sistemas, entidades de dominio
- **P** (Processes/Processos): P1, P2, P3... = Processos de negocio, fluxos, workflows
- **E** (Endpoints): E1, E2, E3... = APIs, rotas, endpoints
- **D** (Data/Dados): D1, D2, D3... = Tabelas, estruturas de dados, schemas
- **S** (Services/Servicos): S1, S2, S3... = Servicos, integracoes, bibliotecas
- **C** (Constraints/Criterios): C1, C2, C3... = Regras de negocio, validacoes, restricoes
- **AC** (Acceptance Criteria): AC1, AC2, AC3... = Criterios de aceitacao numerados

**Objetivo desta metodologia:**
- Reduzir ambiguidade semantica
- Manter consistencia conceitual
- Permitir edicao posterior manual do codigo
- Garantir rastreabilidade entre texto e implementacao

**REGRA GERAL:**
- NUNCA use emojis ou simbolos especiais nas respostas"""

# ---------------------------------------------------------------------------
# JSON OUTPUT RULES
# Used in: all prompts expecting JSON output
# ---------------------------------------------------------------------------
JSON_OUTPUT_RULES = """\
REGRAS DE OUTPUT JSON:

1. Retorne APENAS JSON valido
2. NAO inclua markdown code blocks (```json ... ```)
3. NAO inclua explicacoes antes ou depois do JSON
4. NAO inclua comentarios dentro do JSON
5. Use aspas duplas para strings (padrao JSON)
6. Escape caracteres especiais corretamente (\\n, \\", \\\\)
7. Nao use trailing commas
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
- ERRADO: Aqui esta o JSON: { ... }
- ERRADO: { "campo": "valor", } (trailing comma)
- ERRADO: { campo: "valor" } (chave sem aspas)

REGRA GERAL:
- NUNCA use emojis ou simbolos especiais nas respostas"""

# ---------------------------------------------------------------------------
# PROJECT CONTEXT TEMPLATE
# Used in: prompts that need project information
# ---------------------------------------------------------------------------
PROJECT_CONTEXT = """\
**INFORMACOES DO PROJETO:**
- Nome: {{ project_name }}
{% if project_description %}
- Descricao: {{ project_description }}
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
- NUNCA use emojis ou simbolos especiais nas respostas"""

# ---------------------------------------------------------------------------
# Helper dict for injection into Jinja2 render context
# ---------------------------------------------------------------------------
ALL_COMPONENTS = {
    "semantic_methodology": SEMANTIC_METHODOLOGY,
    "project_context": PROJECT_CONTEXT,
    "json_output_rules": JSON_OUTPUT_RULES,
}
