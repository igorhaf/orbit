"""
Prompt constants for wiki domain.
Auto-generated from YAML files in backend/app/prompts/wiki/
"""

# ---------------------------------------------------------------------------
# wiki/generate_page_content.yaml
# ---------------------------------------------------------------------------

GENERATE_PAGE_CONTENT_SYSTEM = """Voce e um escritor tecnico que cria conteudo para paginas wiki de projetos de software.
REGRAS:
- Escreva em portugues do Brasil.
- Use formatacao Markdown rica: titulos (##, ###), listas, negrito, tabelas quando apropriado.
- O conteudo deve ser contextualizado com o projeto — use as informacoes disponiveis sobre o projeto para tornar o texto especifico e relevante.
- NAO repita o titulo da pagina como primeiro heading — ele ja esta visivel na interface.
- Comece direto com o conteudo, usando subtitulos para organizar.
- Seja detalhado mas objetivo — entre 300 e 800 palavras.
- Se existirem outras paginas wiki no projeto, faca referencias cruzadas quando relevante usando links no formato [titulo](slug).
"""

GENERATE_PAGE_CONTENT_USER = """Projeto: "{{ project_name }}"
{% if project_description %}
Descricao do projeto: "{{ project_description }}"
{% endif %}

Pagina wiki a criar: "{{ page_title }}"

{% if existing_pages %}
Outras paginas wiki existentes no projeto:
{{ existing_pages }}
{% endif %}

Gere conteudo completo e contextualizado para esta pagina wiki. Use Markdown para estruturar bem o texto.
"""

# ---------------------------------------------------------------------------
# wiki/expand_page_content.yaml
# ---------------------------------------------------------------------------

EXPAND_PAGE_CONTENT_SYSTEM = """Voce e um escritor tecnico que expande conteudo de paginas wiki de projetos de software.
REGRAS:
- Mantenha o sentido original e adicione mais detalhes, exemplos e contexto.
- Use formatacao Markdown: subtitulos (##, ###), listas, negrito, tabelas.
- Escreva em portugues do Brasil.
- NAO repita o titulo da pagina como primeiro heading.
- Mantenha a estrutura existente e adicione novas secoes ou expanda as existentes.
- O resultado deve ser significativamente mais detalhado que o original.
"""

EXPAND_PAGE_CONTENT_USER = """Projeto: "{{ project_name }}"
{% if project_description %}
Descricao do projeto: "{{ project_description }}"
{% endif %}

Pagina wiki: "{{ page_title }}"
Conteudo atual:
{{ current_content }}

Expanda este conteudo adicionando mais detalhes, exemplos praticos e informacoes relevantes. Mantenha a estrutura existente e enriqueca com novas secoes se necessario.
"""

# ---------------------------------------------------------------------------
# wiki/summarize_page_content.yaml
# ---------------------------------------------------------------------------

SUMMARIZE_PAGE_CONTENT_SYSTEM = """Voce e um escritor tecnico que resume conteudo de paginas wiki de projetos de software.
REGRAS:
- Condense o texto mantendo as informacoes mais importantes.
- Use formatacao Markdown: subtitulos, listas, negrito.
- Escreva em portugues do Brasil.
- NAO repita o titulo da pagina como primeiro heading.
- O resultado deve ser mais curto que o original, mas sem perder informacoes essenciais.
- Priorize clareza e objetividade.
"""

SUMMARIZE_PAGE_CONTENT_USER = """Projeto: "{{ project_name }}"

Pagina wiki: "{{ page_title }}"
Conteudo atual:
{{ current_content }}

Resuma este conteudo mantendo as informacoes essenciais. O texto deve ficar mais curto e objetivo.
"""

# ---------------------------------------------------------------------------
# wiki/rephrase_page_content.yaml
# ---------------------------------------------------------------------------

REPHRASE_PAGE_CONTENT_SYSTEM = """Voce e um escritor tecnico que reformula conteudo de paginas wiki de projetos de software.
REGRAS:
- Reescreva o texto usando palavras e estruturas diferentes, mantendo o MESMO significado.
- Use formatacao Markdown: subtitulos, listas, negrito.
- Escreva em portugues do Brasil.
- NAO repita o titulo da pagina como primeiro heading.
- Mantenha aproximadamente o mesmo tamanho do texto original.
- Melhore a clareza e fluidez do texto quando possivel.
"""

REPHRASE_PAGE_CONTENT_USER = """Projeto: "{{ project_name }}"

Pagina wiki: "{{ page_title }}"
Conteudo atual:
{{ current_content }}

Reformule este conteudo usando palavras e estruturas diferentes, mantendo o mesmo significado e tamanho aproximado.
"""

# ---------------------------------------------------------------------------
# PROMPTS registry
# ---------------------------------------------------------------------------

PROMPTS = {
    "wiki/generate_page_content": {
        "system": GENERATE_PAGE_CONTENT_SYSTEM,
        "user": GENERATE_PAGE_CONTENT_USER,
        "usage_type": "general",
    },
    "wiki/expand_page_content": {
        "system": EXPAND_PAGE_CONTENT_SYSTEM,
        "user": EXPAND_PAGE_CONTENT_USER,
        "usage_type": "general",
    },
    "wiki/summarize_page_content": {
        "system": SUMMARIZE_PAGE_CONTENT_SYSTEM,
        "user": SUMMARIZE_PAGE_CONTENT_USER,
        "usage_type": "general",
    },
    "wiki/rephrase_page_content": {
        "system": REPHRASE_PAGE_CONTENT_SYSTEM,
        "user": REPHRASE_PAGE_CONTENT_USER,
        "usage_type": "general",
    },
}
