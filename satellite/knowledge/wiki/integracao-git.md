---
title: "Integração Git"
slug: "integracao-git"
source: "generated"
order_index: 15
created_at: "2026-03-05T04:46:25.658396"
updated_at: "2026-03-05T04:46:25.658396"
---

# Integração Git

## GitService

Wrapper sobre git CLI para operações de repositório.

### Operações
- `status()`: Arquivos modificados, staged, untracked
- `diff()`: Diff de alterações para commit message generation
- `log()`: Histórico recente para consistência de estilo
- `commit()`: Commit com message gerada por AI
- `push()`: Push para remote

## Commit Message Generation

### Modelo Padrão
Gemini 1.5 Pro (usage_type: commit_generation)

### Formato
Conventional Commits:
```
<type>: <description>

<body>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### Tipos
feat, fix, docs, refactor, test, chore, perf

### Input para AI
- git diff (alterações)
- Lista de arquivos modificados
- Últimos 5 commits (para consistência de estilo)

