---
title: "Convenções de Desenvolvimento"
slug: "convencoes-desenvolvimento"
source: "generated"
order_index: 20
created_at: "2026-03-05T04:46:26.033693"
updated_at: "2026-03-05T04:46:26.033693"
---

# Convenções de Desenvolvimento

## Frontend (Next.js 14)

### Padrões
- `'use client';` no topo de páginas com interatividade
- Layout: `<Layout><Breadcrumbs />` + `<div className="space-y-6">`
- Grid responsivo: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`
- Cores: blue-600 (primary), green-600 (success), red-600 (danger)

### Organização
```
frontend/src/
├── app/           # Pages (App Router)
├── components/    # Componentes reutilizáveis
│   ├── layout/    # Navbar, Layout, Breadcrumbs
│   └── ui/        # Cards, Buttons, Modals
├── hooks/         # Custom hooks
└── lib/
    └── api/       # API clients
```

## Backend (FastAPI)

### Padrões
- Routers: `APIRouter()` + `Depends(get_db)` + `response_model`
- Services: lógica de negócio separada de routes
- Schemas: Base, Create, Update, Response (Pydantic)

### Organização
```
backend/app/
├── routers/       # API endpoints
├── services/      # Business logic
├── models/        # SQLAlchemy ORM
├── schemas/       # Pydantic schemas
├── prompts/       # 76 YAML prompts
└── core/          # Config, database, security
```

## Git
- Conventional Commits: feat/fix/docs/refactor/test/chore/perf
- PROMPT #N no body quando aplicável
- Co-Authored-By no footer
- Branch principal: main

## Documentação
- Reports: `satellite/knowledge/PROMPT_N_*.md`
- Wiki: `satellite/knowledge/wiki/*.md` (YAML front matter)
- NUNCA .md na raiz (exceto CLAUDE.md e README.md)

