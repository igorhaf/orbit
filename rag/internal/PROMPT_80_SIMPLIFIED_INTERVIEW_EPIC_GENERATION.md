# PROMPT #80 - Simplified Interview Flow with Epic Generation
## Entrada Obrigatória + Geração de Épico Separada

**Date:** 2026-01-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement / UX Simplification
**Impact:** Fluxo de entrevista mais claro com entrada obrigatória e geração de Epic separada

---

## Objective

Simplificar o fluxo de entrevistas para:

1. **ENTRADA** (obrigatória): Título + Descrição do projeto
2. **ENTREVISTA**: Perguntas abertas contextualizadas
3. **SAÍDA**: Geração de Epic (manual, separado de Stories/Tasks)

**Mudança Fundamental:**
- **DE:** Description opcional + Botão "Generate Backlog" (gera Epic + Stories + Tasks de uma vez)
- **PARA:** Description obrigatória + Botão "Gerar Épico" (gera apenas Epic)

---

## What Was Implemented

### 1. Backend: Description Obrigatória

**File:** [backend/app/schemas/project.py](backend/app/schemas/project.py)

```python
# ANTES
description: Optional[str] = Field(None, description="Project description")

# DEPOIS
description: str = Field(..., min_length=1, max_length=2000, description="Project description (required)")
```

### 2. Frontend: Form de Criação Atualizado

**File:** [frontend/src/app/projects/new/page.tsx](frontend/src/app/projects/new/page.tsx)

- Label mudou de "Description" para "Description *"
- Placeholder atualizado: "Describe what you want to build. This will be the input for the AI interview."
- Validação adicionada: `if (!description.trim()) { alert('...'); return; }`
- Botão "Next: Interview" desabilitado quando description está vazio

### 3. Frontend: Nova API de Backlog

**File:** [frontend/src/lib/api.ts](frontend/src/lib/api.ts)

```typescript
// PROMPT #80 - Backlog Generation API
export const backlogApi = {
  generateEpic: (interviewId: string, projectId: string) => ...,
  approveEpic: (suggestion: any, projectId: string, interviewId: string) => ...,
  generateStories: (epicId: string, projectId: string) => ...,
  approveStories: (suggestions: any[], projectId: string) => ...,
  generateTasks: (storyId: string, projectId: string) => ...,
  approveTasks: (suggestions: any[], projectId: string) => ...,
};
```

### 4. Frontend: Botão "Gerar Épico"

**File:** [frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx)

```typescript
// ANTES
const handleGeneratePrompts = async () => {
  // Gerava Epic + Stories + Tasks (async job)
  await interviewsApi.generatePromptsAsync(interviewId);
};

// DEPOIS
const handleGenerateEpic = async () => {
  // 1. Gera sugestão de Epic
  const generateResponse = await backlogApi.generateEpic(interviewId, projectId);

  // 2. Aprova automaticamente
  const epic = await backlogApi.approveEpic(epicSuggestion, projectId, interviewId);

  // 3. Notifica usuário
  alert(`✅ Epic Created!\n\nTitle: ${epic.title}`);
};
```

**Botão:**
```jsx
<Button onClick={handleGenerateEpic}>
  🎯 Gerar Épico
</Button>
```

---

## Files Modified

### Backend:
1. **[backend/app/schemas/project.py](backend/app/schemas/project.py)**
   - `description` mudou de `Optional[str]` para `str` (obrigatório)
   - Adicionado `min_length=1, max_length=2000`

2. **[backend/app/api/routes/projects.py](backend/app/api/routes/projects.py)**
   - Documentação do endpoint atualizada

### Frontend:
3. **[frontend/src/app/projects/new/page.tsx](frontend/src/app/projects/new/page.tsx)**
   - Validação de description adicionada
   - Label e placeholder atualizados
   - Botão desabilitado quando vazio

4. **[frontend/src/lib/api.ts](frontend/src/lib/api.ts)**
   - Nova seção `backlogApi` com endpoints de geração

5. **[frontend/src/components/interview/ChatInterface.tsx](frontend/src/components/interview/ChatInterface.tsx)**
   - Nova função `handleGenerateEpic()`
   - Botão mudou de "Generate Backlog" para "Gerar Épico"
   - Progress bar atualizada para Epic

---

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    CRIAR PROJETO                                 │
├─────────────────────────────────────────────────────────────────┤
│  Título *: [________________________________]                    │
│  Descrição *: [________________________________]                 │
│              [________________________________]                   │
│              [________________________________]                   │
│                                                                  │
│  ℹ️ Descrição será usada como contexto para IA e Epic           │
│                                                                  │
│                              [Próximo: Entrevista]               │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ENTREVISTA                                 │
├─────────────────────────────────────────────────────────────────┤
│  AI: ❓ Pergunta 1: O que você espera do sistema?               │
│                                                                  │
│      ○ Opção A                                                   │
│      ○ Opção B                                                   │
│      ○ Opção C                                                   │
│                                                                  │
│  💬 Ou digite sua resposta...                                   │
│                                                                  │
│  [═══════════════════════════════════════════════]              │
│                                                                  │
│                              [🎯 Gerar Épico]                   │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EPIC GERADO                                   │
├─────────────────────────────────────────────────────────────────┤
│  ✅ Epic Criado!                                                │
│                                                                  │
│  Título: [Nome do Epic]                                         │
│                                                                  │
│  Agora você pode:                                               │
│  1. Ver o Epic no Backlog                                       │
│  2. Gerar Stories a partir do Epic                              │
│  3. Gerar Tasks a partir das Stories                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Hierarchy Generation Flow

Cada nível da hierarquia é gerado separadamente (manual):

```
ENTREVISTA
    ↓
[Gerar Épico]  ← PROMPT #80 (implementado)
    ↓
EPIC criado no Backlog
    ↓
[Gerar Stories]  ← Futuro (manual)
    ↓
STORIES criadas
    ↓
[Gerar Tasks]  ← Futuro (manual)
    ↓
TASKS criadas
    ↓
[Gerar Subtasks]  ← Futuro (manual)
    ↓
SUBTASKS criadas
```

---

## Key Changes Summary

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Description | Opcional | **Obrigatório** |
| Botão | "Generate Backlog" | "Gerar Épico" |
| Geração | Epic + Stories + Tasks (tudo junto) | **Apenas Epic** |
| Fluxo | Assíncrono (job polling) | **Síncrono** (gera e aprova direto) |
| Aprovação | Automática após job | **Automática imediata** |

---

## Testing

### Manual Testing:

1. **Criar Projeto**
   - Tentar criar sem descrição → Deve bloquear ✅
   - Criar com título + descrição → Funciona ✅

2. **Entrevista**
   - Perguntas abertas contextualizadas ✅
   - Botão "Gerar Épico" visível ✅

3. **Gerar Epic**
   - Clicar "Gerar Épico" → Mostra loading ✅
   - Epic criado no Backlog ✅
   - Alert de sucesso ✅

---

## Status: COMPLETE

**Key Achievements:**
- ✅ Description agora é obrigatória na criação de projeto
- ✅ Botão mudou de "Generate Backlog" para "Gerar Épico"
- ✅ Geração de Epic é separada de Stories/Tasks
- ✅ Fluxo simplificado: gera e aprova automaticamente

**Impact:**
- Entrada mais completa (descrição obrigatória contextualiza melhor a IA)
- Geração em fases (Epic → Stories → Tasks → Subtasks)
- UX mais clara e controlada

---
