# PROMPT #243 - Pinned Fragments (Persistência Visual)

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Quando o usuário seleciona um trecho de texto na descrição do projeto e clica no botão "Persistência" (PROMPT #242), o trecho é:

1. **Salvo no banco de dados** como fragmento fixado (pinned_fragment)
2. **Destacado visualmente** na descrição com fundo preto e letras brancas
3. **Preservado literalmente pela IA** quando o texto é regenerado (Detalhar/Resumir)
4. As palavras que a IA usa para manter a regra de negócio no novo texto também ficam destacadas

Clicar no trecho destacado remove a fixação (unpin).

---

## What Was Implemented

### Backend — Model + Schema + Migration

1. **`pinned_fragments`** — novo campo JSON no modelo Project (array de strings)
2. **`ProjectUpdate`** — aceita `pinned_fragments` para update via PATCH
3. **`ProjectResponse`** — retorna `pinned_fragments` na resposta
4. **Alembic migration** `p243_pinned_fragments.py` — adiciona coluna ao PostgreSQL

### Backend — Endpoints (expand/summarize)

5. **`POST /expand-description`** e **`POST /summarize-description`** agora recebem `pinned_fragments` no body
6. **`_process_description_async()`** aceita `pinned_fragments` e inclui no prompt YAML como variável

### Backend — Prompts YAML v3

7. **`expand_description.yaml` v3** — regra crítica no system_prompt + trechos fixados no user_prompt
8. **`summarize_description.yaml` v3** — mesma regra, trechos devem aparecer literalmente mesmo no resumo

### Frontend — page.tsx

9. **`onPersistSelection`** — handler que salva fragmento via `projectsApi.update()` e recarrega projeto
10. **`onUnpinFragment`** — handler que remove fragmento do array e atualiza
11. **`handleExpandDescription`/`handleSummarizeDescription`** — agora enviam `pinned_fragments` no body
12. **`startDescriptionJob`** — tipo do body alterado para `Record<string, any>` para suportar arrays

### Frontend — OverviewTab.tsx

13. **`highlightPinnedFragments()`** — função que split texto por regex dos fragmentos e renderiza spans destacados
14. **`renderChildrenWithHighlights()`** — processa React children recursivamente para aplicar highlights
15. **Custom ReactMarkdown components** — `p`, `li`, `strong`, `em` sobrescritos para aplicar highlighting
16. **Props novas**: `pinnedFragments`, `onUnpinFragment`
17. **Estilo visual**: `bg-gray-900 text-white px-1 rounded` + hover vermelho para indicar remoção

### Frontend — types.ts

18. **`Project.pinned_fragments`** — campo opcional `string[] | null`
19. **`ProjectUpdate.pinned_fragments`** — campo opcional para updates

---

## Files Modified

| File | Changes |
|------|---------|
| `backend/app/models/project.py` | Novo campo `pinned_fragments` (JSON) |
| `backend/app/schemas/project.py` | `pinned_fragments` em ProjectUpdate e ProjectResponse |
| `backend/app/api/routes/projects.py` | Endpoints expand/summarize agora aceitam e passam `pinned_fragments` |
| `backend/app/services/project_service.py` | `_process_description_async` aceita e injeta `pinned_fragments` no prompt |
| `backend/app/prompts/projects/expand_description.yaml` | v3 — regra de preservação de trechos fixados |
| `backend/app/prompts/projects/summarize_description.yaml` | v3 — regra de preservação de trechos fixados |
| `frontend/src/app/projects/[id]/page.tsx` | Handlers persist/unpin, envio de pinned_fragments nos jobs |
| `frontend/src/app/projects/[id]/OverviewTab.tsx` | Highlight visual, props novas, ReactMarkdown custom components |
| `frontend/src/lib/types.ts` | `pinned_fragments` em Project e ProjectUpdate |

## Files Created

| File | Description |
|------|-------------|
| `backend/alembic/versions/p243_pinned_fragments.py` | Migration: adiciona coluna pinned_fragments |

---

## Architecture: Pinned Fragments Flow

```
1. User selects text in description → "Persistência" button appears
   ↓
2. User clicks button → onPersistSelection(text)
   ↓
3. Frontend: PATCH /api/v1/projects/{id} with pinned_fragments: [...current, newText]
   ↓
4. Backend: Saves to project.pinned_fragments (JSON array)
   ↓
5. Frontend: Reloads project data → description re-renders with highlights
   ↓
6. Highlighted text: bg-gray-900 text-white (fundo preto, letras brancas)
   ↓
7. Click on highlighted text → onUnpinFragment(text) → removes from array

--- When AI regenerates (Detalhar/Resumir): ---

8. Frontend sends pinned_fragments in request body
   ↓
9. Backend injects as prompt variable: "TRECHOS FIXADOS (devem aparecer literalmente)"
   ↓
10. AI preserves fragments word-for-word in new text
   ↓
11. Frontend re-renders → fragments auto-highlighted in new text via regex matching
```

---

## UX Design

### Visual:
- **Trecho fixado**: `bg-gray-900 text-white px-1 rounded` (fundo preto, letras brancas, padding horizontal, bordas arredondadas)
- **Hover**: `hover:bg-red-700` (vermelho ao passar mouse, indicando remoção)
- **Tooltip**: "Trecho fixado — clique para remover"
- **Transição**: `transition-colors` para animação suave

### Comportamento:
- Selecionar texto + clicar "Persistência" = fixa trecho
- Clicar no trecho destacado = remove fixação
- Trechos duplicados são ignorados
- Regex matching é greedy (fragmentos mais longos têm prioridade)

---

## Testing Results

- TypeScript: zero erros nos arquivos modificados
- Python: model e schema importam corretamente
- Database: coluna adicionada com sucesso
- Prompts YAML v3: variável opcional `pinned_fragments` com Jinja2 conditional

---

## REGRA #0 Compliance

- Trechos fixados são dados do usuário (sagrados) — jamais sobrescritos pela IA
- A IA recebe instrução EXPLÍCITA de preservar trechos literalmente
- O botão requer clique manual (sem ação automática)
- Remoção de fixação também requer clique explícito do usuário
