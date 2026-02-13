# PROMPT #130 - Interview Tree View
## Hierarchical Tree for Project Interviews

**Date:** January 31, 2026
**Status:** COMPLETED
**Priority:** MEDIUM
**Type:** Feature Implementation
**Impact:** Better visualization and navigation of project interviews

---

## Objective

Implementar uma visualização em árvore das entrevistas na aba "Interviews" do projeto, similar ao Kanban board, mostrando:
1. **Context Interview** como raiz (se existir)
2. **Cards** (Epics, Stories, Tasks, Subtasks) com suas entrevistas associadas

**Key Requirements:**
1. Mostrar Context Interview como nó raiz
2. Mostrar cards do backlog com suas entrevistas filhas
3. Permitir expandir/colapsar nós
4. Permitir criar nova entrevista para qualquer card
5. Manter funcionalidade de deletar entrevistas

---

## What Was Implemented

### 1. InterviewTree Component

Novo componente que renderiza a árvore hierárquica de entrevistas e cards.

**Features:**
- Busca entrevistas e backlog do projeto
- Monta estrutura de árvore combinando entrevistas e tasks
- Context Interview como nó raiz
- Cards com suas entrevistas como filhas
- Expand/collapse para navegação
- Botão para criar entrevista para cada card
- Botão para deletar entrevistas
- Legend com ícones para cada tipo

### 2. Updated Interview Types

Adicionados novos campos ao tipo Interview:
- `parent_task_id`: ID da task pai para entrevistas de card
- `motivation_type`: Tipo de motivação (bug, feature, etc.)

### 3. Updated Interviews Tab

A aba "Interviews" agora usa o `InterviewTree` ao invés do `InterviewList`, mostrando a visualização hierárquica.

---

## Files Modified/Created

### Created:
1. **[InterviewTree.tsx](frontend/src/components/interview/InterviewTree.tsx)**
   - Novo componente de árvore hierárquica
   - ~400 linhas
   - Features: tree view, expand/collapse, create/delete interviews

### Modified:
1. **[types.ts](frontend/src/lib/types.ts)**
   - Added `parent_task_id` and `motivation_type` to Interview interface
   - Added `parent_task_id` and `use_card_focused` to InterviewCreate interface

2. **[index.ts](frontend/src/components/interview/index.ts)**
   - Added export for InterviewTree component

3. **[page.tsx](frontend/src/app/projects/[id]/page.tsx)**
   - Replaced InterviewList with InterviewTree in interviews tab
   - Removed duplicate "New Interview" button from header

4. **[interview.py](backend/app/schemas/interview.py)**
   - Added `parent_task_id` and `motivation_type` to InterviewResponse

---

## Tree Structure

```
🌐 Context Interview (root - if exists)
├── 🎯 Epic 1
│   ├── 💬 Epic Interview (if exists)
│   └── 📖 Story 1.1
│       ├── 💬 Story Interview (if exists)
│       └── ✓ Task 1.1.1
│           └── 💬 Task Interview (if exists)
├── 🎯 Epic 2
│   └── 💬 Interview (if exists)
└── 🐛 Bug 1
    └── 💬 Bug Interview (if exists)
```

---

## UI Features

### Legend
- 🌐 Context Interview
- 💬 Card Interview
- 🎯 Epic
- 📖 Story
- ✓ Task
- ◦ Subtask
- 🐛 Bug

### Actions
- Click on interview → Navigate to interview page
- Click on card → Expand/collapse children
- 💬 button on card → Create new interview for that card
- 🗑️ button on interview → Delete interview

### Visual Feedback
- Interviews highlighted with blue background
- Status badges (active/completed)
- Indentation showing hierarchy
- Border lines connecting parent-child

---

## Technical Details

### Data Flow

1. Component loads interviews and backlog in parallel
2. Creates interview-to-task mapping via `parent_task_id`
3. Builds tree structure:
   - Context interview as root node
   - Other root interviews (without parent)
   - Backlog items with their associated interviews
4. Renders tree recursively with depth tracking

### State Management

- `expandedIds`: Set of expanded node IDs
- `interviews`: All project interviews
- `backlog`: Hierarchical task structure
- Auto-expands context interview on load

---

## Success Metrics

- ✅ Tree view displays correctly
- ✅ Context interview shown as root
- ✅ Cards show with their interviews
- ✅ Expand/collapse works
- ✅ Create interview button works
- ✅ Delete interview button works
- ✅ Navigation to interview page works
- ✅ No TypeScript errors
- ✅ Build passes

---

## Key Insights

### 1. Reusing Existing Data
The implementation leverages existing `parent_task_id` field in Interview model that was added in PROMPT #68 for dual-mode interviews.

### 2. Combined Data Sources
Tree combines two data sources:
- Interviews API (for interview data)
- Backlog API (for task hierarchy)

### 3. Future Enhancement
Card Interview functionality (inference mode) can be added later to allow updating card content based on interview results.

---

## Status: COMPLETE

The interview tree view has been implemented successfully. Users can now see a hierarchical view of all interviews in their project, organized by the cards they relate to.

**Key Achievements:**
- ✅ New InterviewTree component created
- ✅ Hierarchical visualization of interviews
- ✅ Integrated with existing interview system
- ✅ Actions for create/delete/navigate

**Impact:**
- Better organization of interviews by card
- Easier navigation between related interviews
- Clear visual hierarchy of project structure

---
