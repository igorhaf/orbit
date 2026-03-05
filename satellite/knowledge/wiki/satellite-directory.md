---
title: "Estrutura Satellite"
slug: "satellite-directory"
source: "generated"
order_index: 23
created_at: "2026-03-05T04:46:26.234198"
updated_at: "2026-03-05T04:46:26.234198"
---

# Estrutura Satellite

## Diretório Base de Conhecimento

Cada projeto ORBIT tem um diretório `satellite/` dentro do seu `code_path`:

```
satellite/
├── memory/              # Logs de execução IA (auto-salvos)
├── docs/                # Documentos externos (vigiado pelo RAG)
├── knowledge/           # Base de conhecimento estruturada
│   ├── wiki/            # Wiki pages (.md com YAML front matter)
│   ├── results/         # Resultados do Claude Code
│   ├── prompts/         # Prompts exportados
│   └── PROMPT_*.md      # Reports de implementação
└── README.md            # Descrição auto-gerada
```

## Regras

- Reports de PROMPT vão em `satellite/knowledge/`
- Upload de docs externos vai para `satellite/docs/` (vigiado pelo RAG)
- Wiki pages ficam em `satellite/knowledge/wiki/`
- CLAUDE.md e README.md permanecem na raiz (são especiais)
- satellite/ é excluída do scan de tech stack
- satellite/ É indexada pelo RAG scanner

## Auto-Análise

O ORBIT pode analisar seu PRÓPRIO codebase:
1. Criar projeto com `code_path` apontando para raiz do ORBIT
2. satellite/ criada automaticamente
3. Scanner respeita .gitignore e IGNORE_DIRECTORIES

