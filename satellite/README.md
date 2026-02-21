# Orbit

Base de conhecimento gerenciada pelo ORBIT.

## Estrutura

- `memory/` — Logs de execucao de IA (auto-salvos pelo AIOrchestrator)
- `docs/` — Documentos externos (PDFs, TXTs, etc.) vigiados pelo RAG para analise
- `knowledge/` — Base de conhecimento estruturada
  - `wiki/` — Wiki pages (.md com YAML front matter)
  - `results/` — Resultados de execucao do Claude Code (lidos pelos cards)
  - `prompts/` — Prompts exportados para execucao no Claude Code
