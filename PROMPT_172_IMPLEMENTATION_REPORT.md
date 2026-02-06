# PROMPT #172 - Integrar RAG Stats no Frontend
## Adicionar seções de Document Storage (Global e Por Projeto)

**Date:** February 5, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Usuários podem visualizar estatísticas de documentos RAG tanto globalmente quanto por projeto

---

## Objective

Integrar estatísticas de documentos RAG no frontend em dois escopos:
1. **Global** - Página `/rag` mostra total de todos os projetos
2. **Por Projeto** - Aba RAG de cada projeto mostra documentos daquele projeto

**Key Requirements:**
1. Adicionar tipo TypeScript `GlobalRagStats`
2. Adicionar função de API `getGlobalStats()`
3. Criar seção "Global Document Storage" na página `/rag`
4. Criar seção "Document Storage" na aba RAG de cada projeto

---

## Architecture Decision

A arquitetura de RAG do ORBIT tem **dois escopos**:

| Escopo | Localização | Endpoint | O que mostra |
|--------|-------------|----------|--------------|
| **Global** | Página `/rag` | `/api/v1/knowledge/global-stats` | Stats de TODOS os projetos |
| **Por Projeto** | Aba RAG em `/projects/[id]` | `/api/v1/projects/{id}/knowledge/full-stats` | Stats daquele projeto |

---

## What Was Implemented

### PARTE 1: Página Global `/rag`

#### 1.1. Tipo TypeScript `GlobalRagStats`

**Arquivo:** `frontend/src/lib/types.ts`

```typescript
export interface GlobalRagStats {
  total_documents: number;
  by_type: {
    [key: string]: number;  // card, interview_answer, project_context, code_file, etc.
  };
  cards_breakdown: {
    epic?: number;
    story?: number;
    task?: number;
    subtask?: number;
  };
  project_id: string | null;
}
```

#### 1.2. Função de API `getGlobalStats()`

**Arquivo:** `frontend/src/lib/api.ts`

```typescript
getGlobalStats: () =>
  request<{
    success: boolean;
    stats: GlobalRagStats;
  }>('/api/v1/knowledge/global-stats'),
```

#### 1.3. Seção "Global Document Storage"

**Arquivo:** `frontend/src/app/rag/page.tsx`

Nova seção no topo da página com:
- Grid de 6 cards (Total, Code Files, Cards, Interview Answers, Project Context, Business Rules)
- Cards Breakdown (Epic, Story, Task, Subtask)
- Seção "Other Document Types" para tipos adicionais

---

### PARTE 2: Aba RAG do Projeto `/projects/[id]`

#### 2.1. Novo Estado `knowledgeStats`

**Arquivo:** `frontend/src/app/projects/[id]/page.tsx`

```typescript
const [knowledgeStats, setKnowledgeStats] = useState<{
  total_documents: number;
  business_rules_count: number;
  interview_answers_count: number;
  code_files_count: number;
  documents_count: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
} | null>(null);
```

#### 2.2. Busca de Stats na `loadRagStats()`

```typescript
const [rag, code, knowledge] = await Promise.all([
  ragApi.stats(),
  ragApi.codeStats(projectId),
  knowledgeApi.getFullStats(projectId)  // NEW
]);
setKnowledgeStats(knowledge);
```

#### 2.3. Seção "Document Storage" na Aba RAG

Nova Card com:
- Grid de 4 métricas (Total, Code Files, Interview Answers, Business Rules)
- Breakdown "By Source" (code_scan, interview, manual, etc.)
- Breakdown "By Category" para business rules (validation, workflow, etc.)

---

## Files Modified

### Modified:
1. **[frontend/src/lib/types.ts](frontend/src/lib/types.ts)**
   - Added `GlobalRagStats` interface
   - Lines added: ~15

2. **[frontend/src/lib/api.ts](frontend/src/lib/api.ts)**
   - Added `getGlobalStats()` method to `knowledgeApi`
   - Lines added: ~15

3. **[frontend/src/app/rag/page.tsx](frontend/src/app/rag/page.tsx)**
   - Added state: `globalStats`, `loadingGlobalStats`
   - Added `fetchGlobalStats()` callback and useEffect
   - Added "Global Document Storage" Card section
   - Lines added: ~120

4. **[frontend/src/app/projects/[id]/page.tsx](frontend/src/app/projects/[id]/page.tsx)**
   - Added import: `knowledgeApi`
   - Added state: `knowledgeStats`
   - Modified `loadRagStats()` to also fetch `getFullStats()`
   - Added "Document Storage" Card section in RAG tab
   - Lines added: ~60

---

## Visual Layout

### Página Global `/rag`:

```
+----------------------------------------------------------+
| RAG Analytics                                    [Refresh]|
+----------------------------------------------------------+
|                                                          |
| +-- GLOBAL DOCUMENT STORAGE (All Projects) -------------+|
| |  [Total]  [Code]  [Cards]  [Answers]  [Context] [Rules]|
| |   300      236      20        15         5        10   |
| |                                                        |
| |  Cards Breakdown:                                      |
| |  [Epic: 5] [Story: 8] [Task: 5] [Subtask: 2]          |
| +--------------------------------------------------------+|
|                                                          |
| +-- PROJECT SPECIFIC ------------------------------------+|
| |  [Select Project v]  [Sync to RAG]  [Refresh]          |
| +--------------------------------------------------------+|
+----------------------------------------------------------+
```

### Aba RAG do Projeto `/projects/[id]`:

```
+----------------------------------------------------------+
| RAG Analytics (Project Tab)                              |
+----------------------------------------------------------+
|                                                          |
| +-- RAG STATS ------------------------------------------+|
| |  Hit Rate | Similarity | Latency | Results            |
| +--------------------------------------------------------+|
|                                                          |
| +-- CHARTS & TABLE -------------------------------------+|
| |  [Pie Chart]         |    [Usage Type Table]          |
| +--------------------------------------------------------+|
|                                                          |
| +-- DOCUMENT STORAGE (NEW) -----------------------------+|
| |  [Total: 45]  [Code: 30]  [Answers: 10]  [Rules: 5]   |
| |                                                        |
| |  By Source: [code_scan: 30] [interview: 10] [manual: 5]|
| +--------------------------------------------------------+|
|                                                          |
| +-- CODE INDEXING PANEL --------------------------------+|
| |  [Index Code]  [Force Re-index]                       |
| +--------------------------------------------------------+|
+----------------------------------------------------------+
```

---

## Testing

### Verification Steps:

**Página Global:**
1. Acessar `/rag` no frontend
2. Verificar "Global Document Storage" no topo
3. Verificar números batem com: `curl http://localhost:8000/api/v1/knowledge/global-stats`

**Aba do Projeto:**
1. Acessar `/projects/[id]` e clicar na aba "RAG Analytics"
2. Verificar seção "Document Storage" aparece
3. Verificar números batem com: `curl http://localhost:8000/api/v1/projects/{id}/knowledge/full-stats`

---

## Success Metrics

- Página `/rag` exibe stats globais de todos os projetos
- Aba RAG do projeto exibe stats específicos daquele projeto
- Ambas seções têm loading states funcionais
- Cores consistentes entre as duas views
- Breakdowns detalhados (by source, by category)

---

## Key Insights

### 1. Dois Escopos, Mesma UX
As duas seções seguem o mesmo padrão visual, mas com dados de escopos diferentes:
- Global: agregado de todos os projetos
- Projeto: filtrado por project_id

### 2. Endpoint Existente Reutilizado
O endpoint `/projects/{id}/knowledge/full-stats` já existia (PROMPT #147), apenas não estava integrado na aba RAG.

### 3. Cores Consistentes
- Roxo: Total/Global
- Azul: Code Files
- Amarelo: Interview Answers
- Laranja: Business Rules

---

## Status: COMPLETE

**Key Achievements:**
- Seção "Global Document Storage" na página `/rag`
- Seção "Document Storage" na aba RAG de cada projeto
- Integração com endpoints existentes do PROMPT #171 e #147

**Impact:**
- Visibilidade completa do RAG em todos os níveis
- Usuário entende quantos documentos estão indexados por projeto
- Monitoramento facilitado da saúde do RAG

---
