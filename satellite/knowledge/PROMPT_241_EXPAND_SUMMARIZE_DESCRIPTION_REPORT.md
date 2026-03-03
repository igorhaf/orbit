# PROMPT #241 - Botões Detalhar e Resumir Descrição do Projeto

## Status: COMPLETED

## Date: 2026-03-02

---

## Objective

Quando o projeto já possui uma descrição mínima, exibir dois botões de IA ao lado do título "Descrição do Projeto":
- **Detalhar** (expand) — gera versão mais detalhada da descrição existente
- **Resumir** (summarize) — gera versão mais condensada da descrição existente

Quando não há descrição, mantém o botão original de gerar descrição do zero (PROMPT #240).

Todas as operações de descrição devem entrar na fila do PriorityJobExecutor com prioridade NORMAL (5), não executar diretamente.

---

## What Was Implemented

### Backend — Endpoints (via Job Queue)

1. **`POST /api/v1/projects/generate-description`**
   - Body: `{"title": "...", "project_id": "optional-uuid"}`
   - Retorna `{"job_id": "...", "status": "pending"}`
   - Cria `AsyncJob(DESCRIPTION_GENERATION)` com prioridade NORMAL (5)
   - Job executa via `PriorityJobExecutor` e auto-salva descrição no projeto

2. **`POST /api/v1/projects/expand-description`**
   - Body: `{"title": "...", "current_description": "...", "project_id": "optional-uuid"}`
   - Mesmo padrão de job queue acima
   - `max_tokens=800`

3. **`POST /api/v1/projects/summarize-description`**
   - Body: `{"title": "...", "current_description": "...", "project_id": "optional-uuid"}`
   - Mesmo padrão de job queue acima
   - `max_tokens=500`

### Backend — Job Type e Prioridade

4. **`JobType.DESCRIPTION_GENERATION`** adicionado em `async_job.py`
5. **Prioridade NORMAL (5)** em `job_priorities.yaml` e fallback inline
6. **`_process_description_async()`** em `project_service.py` — função background unificada para generate/expand/summarize

### Backend — Prompts YAML

7. **`expand_description.yaml`** v2 — Prompt com markdown progressivo, sem repetir título
8. **`summarize_description.yaml`** v2 — Prompt conciso, sem repetir título
9. **`generate_description.yaml`** v2 — Prompt simples, sem repetir título

### Frontend — page.tsx

10. **`useJobPolling(descriptionJobId)`** — Polling via WebSocket para acompanhar job
11. **`startDescriptionJob()`** — Função unificada que chama endpoint e inicia tracking
12. **`handleGenerateDescription/Expand/Summarize`** — Apenas setam loading e chamam `startDescriptionJob`
13. **`skipAutoFormatRef`** — Previne auto-reformat após operação de IA
14. **`addJob()`** do `useNotifications` — Job aparece no sininho de notificações

### Frontend — OverviewTab.tsx

15. **Props novas**: `expandingDescription`, `onExpandDescription`, `summarizingDescription`, `onSummarizeDescription`
16. **Lógica condicional de botões**:
    - Se `project.description` existe → mostra botão Detalhar (verde, ícone expand) + botão Resumir (laranja, ícone compress)
    - Se `project.description` não existe → mostra botão Gerar (azul, ícone raio) — comportamento do PROMPT #240
17. **Desabilitação mútua** — Quando qualquer operação está em andamento, todos os botões ficam desabilitados

---

## Files Modified

| File | Changes |
|------|---------|
| `backend/app/models/async_job.py` | Novo `JobType.DESCRIPTION_GENERATION` + fallback priority |
| `backend/app/contracts/business/job_priorities.yaml` | `description_generation: 5` (NORMAL) |
| `backend/app/services/project_service.py` | Nova `_process_description_async()` background function |
| `backend/app/api/routes/projects.py` | 3 endpoints refatorados para usar PriorityJobExecutor |
| `frontend/src/app/projects/[id]/page.tsx` | useJobPolling, startDescriptionJob, skipAutoFormatRef |
| `frontend/src/app/projects/[id]/OverviewTab.tsx` | Props novas, lógica condicional de botões |

## Files Created

| File | Description |
|------|-------------|
| `backend/app/prompts/projects/expand_description.yaml` | Prompt YAML para expandir descrição |
| `backend/app/prompts/projects/summarize_description.yaml` | Prompt YAML para resumir descrição |

---

## Architecture: Job Queue Flow

```
1. User clicks "Detalhar" / "Resumir" / "Gerar"
   ↓
2. Frontend: POST /api/v1/projects/{action}-description
   ↓
3. Backend: Creates AsyncJob(DESCRIPTION_GENERATION, priority=5)
   ↓
4. Backend: executor.submit() → enqueues in PriorityJobExecutor
   ↓
5. Backend returns: { job_id, status: "pending" }
   ↓
6. Frontend: useJobPolling(job_id) tracks via WebSocket
   ↓
7. PriorityJobExecutor worker picks up job when available
   ↓
8. _process_description_async: AI call → auto-saves to project
   ↓
9. Job completes → WebSocket notifies frontend
   ↓
10. Frontend: onComplete → setEditedDescription + skipAutoFormat + loadProjectData
```

---

## Bug Fixes

### Fix: Double-formatting bug (descrição reformatada após AI operation)

**Problema:** Ao clicar "Detalhar", a versão bonita com markdown aparecia brevemente, depois era substituída por uma versão com formatação inferior.

**Causa raiz:** O `useEffect` de auto-format em `page.tsx` disparava após `loadProjectData()`, chamando `/api/format-markdown` que sobrescrevia a descrição.

**Solução:** `skipAutoFormatRef` — setado `true` no `onComplete` do job polling, antes de `setEditedDescription` e `loadProjectData`. O useEffect verifica e pula.

### Fix: Título repetido na descrição gerada

**Solução:** Todos os 3 prompts YAML v2: "NÃO repita o nome/título do projeto."

### Fix: Formatação markdown progressiva

**Solução:** `expand_description.yaml` v2 instrui uso progressivo de negrito, listas e subtítulos.

---

## Testing Results

- TypeScript: zero erros nos arquivos modificados
- Backend: import de todos os módulos OK
- Jobs entram na fila com prioridade NORMAL (5)
- Frontend tracked via WebSocket (useJobPolling)
- Prompts externalizados em YAML conforme padrão

---

## REGRA #0 Compliance

- Todos os botões requerem clique manual do usuário
- Não há atualização automática da descrição
- A descrição editada manualmente é preservada até o usuário clicar em um dos botões
- Backend auto-salva no projeto somente quando o job foi disparado por clique explícito
