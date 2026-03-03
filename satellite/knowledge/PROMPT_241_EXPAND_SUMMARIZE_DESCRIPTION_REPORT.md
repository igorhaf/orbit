# PROMPT #241 - Botões Detalhar e Resumir Descrição do Projeto

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Quando o projeto já possui uma descrição mínima, exibir dois botões de IA ao lado do título "Descrição do Projeto":
- **Detalhar** (expand) — gera versão mais detalhada da descrição existente
- **Resumir** (summarize) — gera versão mais condensada da descrição existente

Quando não há descrição, mantém o botão original de gerar descrição do zero (PROMPT #240).

---

## What Was Implemented

### Backend — Novos Endpoints

1. **`POST /api/v1/projects/expand-description`**
   - Body: `{"title": "...", "current_description": "..."}`
   - Usa prompt YAML `projects/expand_description`
   - Gera descrição expandida de 4-6 frases mantendo o sentido original
   - `max_tokens=800`

2. **`POST /api/v1/projects/summarize-description`**
   - Body: `{"title": "...", "current_description": "..."}`
   - Usa prompt YAML `projects/summarize_description`
   - Gera descrição resumida de 1-2 frases curtas
   - `max_tokens=500`

### Backend — Prompts YAML

3. **`expand_description.yaml`** — Prompt para expandir descrição com mais detalhes, funcionalidades, público-alvo e benefícios
4. **`summarize_description.yaml`** — Prompt para condensar descrição mantendo apenas a essência

### Frontend — page.tsx

5. **Estados** `expandingDescription` e `summarizingDescription`
6. **`handleExpandDescription`** — Chama endpoint expand, salva via `projectsApi.update()`, recarrega
7. **`handleSummarizeDescription`** — Chama endpoint summarize, salva via `projectsApi.update()`, recarrega
8. **Props** passadas ao OverviewTab

### Frontend — OverviewTab.tsx

9. **Props novas**: `expandingDescription`, `onExpandDescription`, `summarizingDescription`, `onSummarizeDescription`
10. **Lógica condicional de botões**:
    - Se `project.description` existe → mostra botão Detalhar (verde, ícone expand) + botão Resumir (laranja, ícone compress)
    - Se `project.description` não existe → mostra botão Gerar (azul, ícone raio) — comportamento do PROMPT #240
11. **Desabilitação mútua** — Quando qualquer operação está em andamento, todos os botões ficam desabilitados

---

## Files Created

| File | Description |
|------|-------------|
| `backend/app/prompts/projects/expand_description.yaml` | Prompt YAML para expandir descrição |
| `backend/app/prompts/projects/summarize_description.yaml` | Prompt YAML para resumir descrição |

## Files Modified

| File | Changes |
|------|---------|
| `backend/app/api/routes/projects.py` | Novos endpoints `expand-description` e `summarize-description` |
| `frontend/src/app/projects/[id]/page.tsx` | Estados, handlers, passagem de props para expand/summarize |
| `frontend/src/app/projects/[id]/OverviewTab.tsx` | Props novas, lógica condicional de botões |

---

## UX Design

### Botões por estado da descrição:

| Estado | Botões exibidos | Cores |
|--------|-----------------|-------|
| Sem descrição | Gerar (raio) | Azul |
| Com descrição | Detalhar (expand) + Resumir (compress) | Verde + Laranja |
| Editando | Nenhum (ocultos) | — |

### Comportamento:
- Todos os botões salvam automaticamente no projeto e recarregam
- Botões desabilitados mutuamente durante operações
- REGRA #0 respeitada: ação sempre explícita via clique

---

## Bug Fixes

### Fix: Double-formatting bug (descrição reformatada após AI operation)

**Problema:** Ao clicar "Detalhar", a versão bonita com markdown aparecia brevemente, depois era substituída por uma versão com formatação inferior.

**Causa raiz:** O `useEffect` de auto-format em `page.tsx` (que converte descrições plain-text para markdown via `/api/format-markdown`) disparava após `loadProjectData()`, sobrescrevendo a descrição já bem formatada retornada pela IA.

**Solução:** Adicionado `skipAutoFormatRef` — um `useRef(boolean)` que:
1. É setado para `true` nos handlers `handleGenerateDescription`, `handleExpandDescription`, `handleSummarizeDescription` antes de `loadProjectData()`
2. O `useEffect` de auto-format verifica o ref e, se `true`, pula a reformatação e reseta o flag
3. Isso garante que a descrição retornada pela IA é preservada sem ser sobrescrita

### Fix: Título repetido na descrição gerada

**Problema:** IA repetia o nome do projeto na descrição.

**Solução:** Todos os 3 prompts YAML atualizados para v2 com regra explícita: "NÃO repita o nome/título do projeto na descrição."

### Fix: Formatação markdown progressiva

**Problema:** Descrições expandidas não usavam markdown rico.

**Solução:** `expand_description.yaml` v2 instrui uso progressivo de **negrito**, listas, e subtítulos conforme a descrição cresce.

---

## Testing Results

- TypeScript: zero erros nos arquivos modificados
- Endpoints reutilizam AIOrchestrator com cache Redis
- Prompts externalizados em YAML conforme padrão
- Bug de double-formatting corrigido via skipAutoFormatRef

---

## REGRA #0 Compliance

- Todos os botões requerem clique manual do usuário
- Não há atualização automática da descrição
- A descrição editada manualmente é preservada até o usuário clicar em um dos botões
