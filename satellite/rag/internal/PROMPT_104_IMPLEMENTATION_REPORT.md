# PROMPT #104 - Contracts Area
## Lista de YAMLs de Prompts do Sistema

**Date:** January 25, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Nova area administrativa para visualizar todos os contracts (YAMLs de prompts) do sistema

---

## Objective

Criar uma nova area chamada **Contracts** no sistema ORBIT para administrar os arquivos YAML de prompts. Versao inicial simplificada com:
- Tabela listando todos os 51 YAMLs do sistema
- Colunas: Category (badge colorido) | Name | Description
- Linhas clicaveis (preparado para navegacao futura)

**Key Requirements:**
1. Endpoint backend GET /api/v1/contracts listando todos os YAMLs
2. Pagina frontend com tabela simples
3. Navegacao no Sidebar e Breadcrumbs

---

## Pattern Analysis

### Existing Patterns Followed

1. **Backend Router Pattern** - Seguiu o padrao de `specs.router` e `prompts.router`
   - Router separado em `api/routes/contracts.py`
   - Registro em `main.py` com prefix e tags

2. **Frontend Page Pattern** - Seguiu o padrao de `specs/page.tsx`
   - 'use client' directive
   - Layout + Breadcrumbs wrapper
   - Card com tabela
   - Loading e empty states
   - Fetch para API backend

3. **Navigation Pattern** - Seguiu o padrao existente em Sidebar.tsx
   - Item adicionado apos "Specs"
   - Icone SVG consistente com outros itens

---

## What Was Implemented

### 1. Backend API Endpoint

Criado `GET /api/v1/contracts` que:
- Usa `PromptLoader.list_prompts()` para listar todos os YAMLs
- Carrega metadata de cada YAML com `PromptLoader.load()`
- Retorna lista ordenada por categoria e nome
- Campos: name, path, category, description

### 2. Frontend Contracts Page

Tabela simples com:
- 3 colunas: Category | Name | Description
- Badges coloridos por categoria (6 cores)
- Linhas clicaveis com hover effect
- Loading spinner durante fetch
- Empty state se nao houver contracts

### 3. Navigation Updates

- Sidebar: Item "Contracts" adicionado apos "Specs"
- Breadcrumbs: Label 'contracts': 'Contracts'

---

## Files Modified/Created

### Created:
1. **[backend/app/api/routes/contracts.py](backend/app/api/routes/contracts.py)**
   - Lines: 54
   - Features: GET /api/v1/contracts endpoint

2. **[frontend/src/app/contracts/page.tsx](frontend/src/app/contracts/page.tsx)**
   - Lines: 132
   - Features: Contracts list page with table

### Modified:
1. **[backend/app/main.py](backend/app/main.py)**
   - Added: import contracts
   - Added: include_router for contracts

2. **[frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)**
   - Added: Contracts navigation item with icon

3. **[frontend/src/components/layout/Breadcrumbs.tsx](frontend/src/components/layout/Breadcrumbs.tsx)**
   - Added: 'contracts': 'Contracts' to routeLabels

---

## Category Color Mapping

| Category | Color | Badge Class |
|----------|-------|-------------|
| backlog | Blue | bg-blue-100 text-blue-800 |
| commits | Green | bg-green-100 text-green-800 |
| components | Purple | bg-purple-100 text-purple-800 |
| context | Orange | bg-orange-100 text-orange-800 |
| discovery | Pink | bg-pink-100 text-pink-800 |
| interviews | Cyan | bg-cyan-100 text-cyan-800 |

---

## Testing Results

### Verification:

```bash
# Backend endpoint
curl http://localhost:8000/api/v1/contracts/
# Expected: Lista de 51 contracts com name, path, category, description

# Frontend page
http://localhost:3000/contracts
# Expected: Tabela com 51 linhas, badges coloridos por categoria

# Navigation
# Expected: "Contracts" aparece no Sidebar apos "Specs"
```

---

## Success Metrics

- **Backend:** Endpoint retorna 51 contracts (todos os YAMLs do sistema)
- **Frontend:** Tabela exibe todos os contracts com badges coloridos
- **UX:** Linhas sao clicaveis e tem hover effect
- **Navigation:** Item aparece corretamente no Sidebar

---

## Key Insights

### 1. Reutilizacao do PromptLoader
O `PromptLoader` ja existente foi perfeito para este caso. O metodo `list_prompts()` ja exclui a pasta `components/` automaticamente e retorna os paths relativos.

### 2. Simplicidade Intencional
A versao inicial foi mantida simples propositalmente:
- Sem filtros
- Sem busca
- Sem pagina de detalhe
Isso permite validar o conceito antes de adicionar complexidade.

### 3. Preparacao para Expansao
O codigo foi estruturado para facilitar expansao futura:
- `handleRowClick` ja preparado para navegacao
- Categorias com cores definidas para filtros futuros

---

## Future Enhancements (Out of Scope)

- [ ] Pagina de detalhe `/contracts/[path]` com conteudo YAML
- [ ] Filtro por categoria
- [ ] Busca por nome/description
- [ ] Visualizacao do system_prompt e user_prompt
- [ ] Edicao inline de prompts
- [ ] Criacao de novos contracts

---

## Status: COMPLETE

Implementacao concluida com sucesso. A area de Contracts esta funcional e pronta para uso.

**Key Achievements:**
- Endpoint backend funcional listando 51 YAMLs
- Pagina frontend com tabela limpa e organizada
- Badges coloridos por categoria
- Navegacao integrada no Sidebar

**Impact:**
- Administradores podem visualizar todos os contracts do sistema
- Base para futura gestao de prompts via interface web
- Alinhado com a estrategia de externalizacao de prompts (PROMPT #103)

---
