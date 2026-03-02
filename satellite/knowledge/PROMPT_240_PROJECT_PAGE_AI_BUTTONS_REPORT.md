# PROMPT #240 - Botões Auto-Gerar Título e Descrição na Página do Projeto

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Adicionar botões de auto-geração via IA para título e descrição diretamente na **página de visualização do projeto** (não apenas no formulário de criação). O usuário pode reformular o título ou gerar uma descrição a partir do título existente.

---

## What Was Implemented

### Page.tsx (Título do Projeto)

1. **Estado `generatingTitle` / `generatingDescription`** — Dois novos estados booleanos para controlar loading dos botões
2. **`handleGenerateTitle`** — Chama `POST /api/v1/projects/generate-title` com a descrição atual do projeto. Salva o resultado via `projectsApi.update()` e recarrega os dados
3. **`handleGenerateDescription`** — Chama `POST /api/v1/projects/generate-description` com o título atual. Salva e recarrega
4. **Botão ao lado do `<h1>`** — Ícone de refresh (mesmo padrão do formulário de criação), desabilitado se não há descrição. Aparece à direita do título

### OverviewTab.tsx (Descrição do Projeto)

5. **Props `generatingDescription` + `onGenerateDescription`** — Novas props opcionais passadas de page.tsx
6. **Botão ao lado de "Descrição do Projeto"** — Ícone de raio (lightning), desabilitado durante geração. Aparece apenas quando não está editando a descrição

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/app/projects/[id]/page.tsx` | Estados, handlers, botão auto-gerar título, passagem de props |
| `frontend/src/app/projects/[id]/OverviewTab.tsx` | Props novas, botão auto-gerar descrição no CardHeader |

---

## REGRA #0 Compliance

- Os botões apenas geram conteúdo quando clicados pelo usuário (ação explícita)
- Não há auto-geração automática — sempre requer clique manual
- O título editado manualmente pelo usuário é preservado até que ele clique no botão

---

## Testing Results

- TypeScript: zero erros nos arquivos alterados
- Endpoints reutilizados: `generate-title` e `generate-description` (já existiam do PROMPT #239)
