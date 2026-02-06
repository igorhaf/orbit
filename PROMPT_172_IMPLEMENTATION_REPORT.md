# PROMPT #172 - Integrar RAG Stats no Frontend
## Tabela Comparativa de Projetos + Global Knowledge

**Date:** February 5, 2026
**Status:** COMPLETED (Updated)
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Dashboard unificado mostrando RAG de todos os projetos com visão comparativa

---

## Objective

Integrar estatísticas de documentos RAG no frontend com uma abordagem que reflete a arquitetura real do ORBIT:
- **ORBIT não tem RAG próprio** - ele orquestra RAGs por projeto
- Página `/rag` mostra **tabela comparativa** de todos os projetos
- Cada projeto tem seu próprio RAG isolado

**Key Requirements:**
1. Tabela comparativa mostrando stats de cada projeto lado a lado
2. Seção de "Global Knowledge" (framework specs, PROMPT docs)
3. Links para navegar ao RAG de cada projeto
4. Totais agregados na última linha

---

## Architecture Decision (Updated)

O ORBIT é um **orquestrador de memória por projeto**, não tem RAG próprio.

| Escopo | Localização | O que mostra |
|--------|-------------|--------------|
| **Per-Project RAG** | Aba RAG em `/projects/[id]` | RAG isolado daquele projeto |
| **Global Knowledge** | Compartilhado | Framework specs + PROMPT docs (project_id=NULL) |
| **Dashboard** | Página `/rag` | Tabela comparativa de TODOS os projetos |

---

## What Was Implemented

### PARTE 1: Backend - Novo Endpoint

**Arquivo:** `backend/app/api/routes/knowledge.py`

```python
@router.get("/knowledge/projects-stats")
async def get_all_projects_rag_stats(db: Session = Depends(get_db)):
    """
    Get RAG statistics for ALL projects in a single call.
    Returns list of projects with stats + totals + global-only stats.
    """
```

**Response:**
```json
{
  "success": true,
  "projects": [
    {
      "project_id": "uuid",
      "project_name": "Project A",
      "total_documents": 150,
      "code_files": 120,
      "cards": 20,
      "business_rules": 5,
      "interview_answers": 3,
      "project_context": 1,
      "documents": 1
    }
  ],
  "totals": {
    "total_documents": 230,
    "code_files": 180,
    ...
  },
  "global_only": {
    "total_documents": 50,
    "framework_specs": 47,
    "prompt_docs": 3
  }
}
```

### PARTE 2: Frontend - API Function

**Arquivo:** `frontend/src/lib/api.ts`

```typescript
getProjectsStats: () =>
  request<{
    success: boolean;
    projects: Array<{
      project_id: string;
      project_name: string;
      total_documents: number;
      code_files: number;
      cards: number;
      business_rules: number;
      interview_answers: number;
      project_context: number;
      documents: number;
    }>;
    totals: { ... };
    global_only: {
      total_documents: number;
      framework_specs: number;
      prompt_docs: number;
    };
  }>('/api/v1/knowledge/projects-stats'),
```

### PARTE 3: Frontend - Projects Comparison Table

**Arquivo:** `frontend/src/app/rag/page.tsx`

Página completamente reescrita com:
1. **Global Knowledge Card** - Framework specs + PROMPT docs
2. **Projects Comparison Table** - Todas as colunas de stats
3. **Totals Row** - Soma de todos os projetos
4. **Action Buttons** - Links para RAG Analytics e Knowledge Base de cada projeto
5. **Info Card** - Explicação sobre RAG no ORBIT

---

## Visual Layout (New)

```
+------------------------------------------------------------------+
| RAG Analytics                                           [Refresh] |
+------------------------------------------------------------------+
|                                                                    |
| +-- GLOBAL KNOWLEDGE (Shared across all projects) ---------------+|
| |  [Total Global: 50]  [Framework Specs: 47]  [PROMPT Docs: 3]   ||
| +----------------------------------------------------------------+|
|                                                                    |
| +-- PROJECTS RAG COMPARISON (3 projects) ------------------------+|
| |                                                                 ||
| | Project      | Total | Code | Cards | Rules | Answers | Docs   ||
| |--------------|-------|------|-------|-------|---------|--------|
| | Project A    |  150  | 120  |  20   |   5   |    3    |   2    ||
| | Project B    |   80  |  60  |  15   |   3   |    1    |   1    ||
| | Project C    |    0  |   0  |   0   |   0   |    0    |   0    ||
| |--------------|-------|------|-------|-------|---------|--------|
| | TOTAL        |  230  | 180  |  35   |   8   |    4    |   3    ||
| +----------------------------------------------------------------+|
|                                                                    |
| +-- ABOUT RAG IN ORBIT ------------------------------------------+|
| | Each project has its own isolated RAG. ORBIT orchestrates...   ||
| +----------------------------------------------------------------+|
+------------------------------------------------------------------+
```

---

## Files Modified

### Backend:
1. **[backend/app/api/routes/knowledge.py](backend/app/api/routes/knowledge.py)**
   - Added endpoint `GET /knowledge/projects-stats`
   - Returns per-project stats, totals, and global-only stats
   - Lines added: ~80

### Frontend:
1. **[frontend/src/lib/api.ts](frontend/src/lib/api.ts)**
   - Added `getProjectsStats()` method to `knowledgeApi`
   - Lines added: ~30

2. **[frontend/src/app/rag/page.tsx](frontend/src/app/rag/page.tsx)**
   - Complete rewrite with projects comparison table
   - Removed old global stats section
   - Added navigation to project RAG/Knowledge pages
   - Lines: ~390 (rewritten)

### Previously Modified (Part 1):
- `frontend/src/lib/types.ts` - GlobalRagStats interface
- `frontend/src/app/projects/[id]/page.tsx` - Document Storage section in RAG tab

---

## Testing

### Verification Steps:

**Backend:**
```bash
curl http://localhost:8000/api/v1/knowledge/projects-stats
```

**Frontend:**
1. Acessar `/rag`
2. Verificar Global Knowledge card no topo
3. Verificar tabela comparativa com todos os projetos
4. Verificar linha de totais no final
5. Clicar nos botões de ação para navegar ao projeto

---

## Success Metrics

- Tabela mostra todos os projetos com suas stats
- Linha de totais soma corretamente
- Global Knowledge mostra framework specs e PROMPT docs
- Navegação para projeto funciona
- Info card explica a arquitetura

---

## Key Insights

### 1. ORBIT como Orquestrador
O ORBIT não tem RAG próprio - ele gerencia RAGs por projeto. A página `/rag` é um **dashboard de monitoramento**, não um RAG global.

### 2. Global Knowledge vs Per-Project
- **Global (project_id=NULL):** Framework specs, PROMPT docs - compartilhados
- **Per-Project:** Cards, rules, answers, code files - isolados

### 3. Comparação Facilita Gestão
A tabela comparativa permite ao admin/PM ver rapidamente:
- Quais projetos têm mais conhecimento indexado
- Quais projetos precisam de mais contexto
- Distribuição por tipo de documento

---

## Status: COMPLETE

**Key Achievements:**
- Novo endpoint `GET /knowledge/projects-stats`
- Tabela comparativa de projetos na página `/rag`
- Seção "Global Knowledge" separada
- Navegação para RAG/Knowledge de cada projeto
- Info card explicando arquitetura

**Impact:**
- Visão unificada de todos os RAGs do sistema
- Fácil comparação entre projetos
- Entendimento claro: ORBIT orquestra, não armazena

---
