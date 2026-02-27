# memory — 2026-02-21

**Model:** claudio/claude-sonnet-4-6
**Status:** success
**Tokens:** 0 in / 0 out | Cost: $0.0000

## System Prompt

Você analisa estruturas de diretórios de projetos para identificar pastas que devem ser
EXCLUIDAS da análise de lógica de negocio.

Estas são pastas contendo:
- Dependencias de terceiros em locais não padrão (bibliotecas vendorizadas, SDKs)
- Internos de frameworks embutidos (código-fonte de framework copiado para o projeto)
- Código gerado ou compilado em diretórios não padrão
- Diretórios grandes de dados, assets ou midia que não contém código-fonte
- Dados de fixtures de teste ou diretórios de exemplo/demo
- Saída de build de documentação

Você DEVE responder APENAS com um objeto JSON válido. Sem markdown, sem explicacoes.

Formato JSON:
{"directories": ["nome_dir_1", "caminho/para/dir2"], "rationale": {"nome_dir_1": "motivo", "caminho/para/dir2": "motivo"}}

Se nenhum diretório adicional deve ser excluido, responda:
{"directories": [], "rationale": {}}

REGRAS CRITICAS:
1. NÃO liste diretórios ja sendo ignorados (fornecidos abaixo)
2. NÃO liste diretórios padrão de dependencias (node_modules, vendor, .git, dist, build, __pycache__, venv, etc.)
3. APENAS liste diretórios NÃO PADRÃO especificos DESTE projeto
4. Use o nome exato do diretório como mostrado na listagem
5. Foque em diretórios com muitos arquivos mas zero ou poucos arquivos de código - provavelmente são assets/dados

## User Prompt

Estrutura de diretórios do projeto (2 níveis de profundidade, mostrando contagem de arquivos):

orbit/ (15 files, 1 code)
  backend/ (13 files, 5 code)
    alembic/ (2 files, 1 code)
    app/ (4 files, 4 code)
    provisioning/ (5 files, 0 code)
    scripts/ (26 files, 19 code)
    test-projects/ (0 files, 0 code)
    tests/ (7 files, 7 code)
    venv_test/ (2 files, 0 code)
  data/ (1 files, 0 code)
    ollama/ (1 files, 0 code)
    qdrant/ (2 files, 0 code)
  docs/ (2 files, 0 code)
  frontend/ (14 files, 4 code)
    public/ (1 files, 0 code)
    src/ (0 files, 0 code)
  projects/ (0 files, 0 code)
    suinda/ (20 files, 1 code)
  rag/ (0 files, 0 code)
    internal/ (1 files, 0 code)
  scripts/ (5 files, 0 code)

Diretórios ja ignorados: *.egg-info, *.xcodeproj, .Python, .cache, .claude-backups, .eclipse, .hg, .idea, .nuxt, .svn, .vercel, .vs, .vuepress, bin, bootstrap/cache, build, coverage, dist, logs, orbit, output, public/build, public/dist, site, site-packages, static/assets, storage/framework, storage/logs, temp, venv

Identifique quaisquer diretórios NÃO PADRÃO que devem ser excluidos da análise de código.
Liste apenas diretórios NÃO cobertos pela lista de ignorados acima.

## Response

```json
{"directories": ["orbit/data", "orbit/projects", "orbit/backend/provisioning", "orbit/backend/venv_test", "orbit/docs", "orbit/frontend/public", "orbit/rag"], "rationale": {"orbit/data": "Diretório de dados persistentes (ollama models, qdrant vector DB) — zero arquivos de código, apenas dados de runtime", "orbit/projects": "Diretório de projetos de usuário (ex: suinda com 20 arquivos mas apenas 1 código) — conteúdo gerado/importado pelo usuário, não lógica de negócio", "orbit/backend/provisioning": "5 arquivos, nenhum de código — provável configuração de infraestrutura/scripts de provisionamento (Docker, Ansible, etc.)", "orbit/backend/venv_test": "Ambiente virtual Python não padrão (venv_test) — análogo a venv/virtualenv, contém dependências de terceiros", "orbit/docs": "2 arquivos, nenhum de código — documentação do projeto, não lógica de negócio", "orbit/frontend/public": "Diretório de assets estáticos públicos — 1 arquivo, nenhum código-fonte", "orbit/rag": "0 arquivos de código diretamente, subdiretório internal com apenas 1 arquivo — estrutura vazia ou de dados para RAG pipeline"}}
```
