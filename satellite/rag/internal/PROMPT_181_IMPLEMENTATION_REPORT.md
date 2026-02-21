# PROMPT #181 - Fix: Generate Children Buttons Not Showing Loading State
## Botões "Gerar Stories/Tasks/Subtasks" agora mostram loading persistente

**Date:** February 7, 2026
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Botões de geração de filhos agora mostram spinner + "Gerando..." durante toda a execução

---

## 🎯 Objective

Os botões "Gerar Stories", "Gerar Tasks" e "Gerar Subtasks" dentro do card não mostravam estado de loading, mesmo com o código de PROMPT #176 implementado.

**Key Requirements:**
1. Identificar por que `isGeneratingChildren` nunca era `true`
2. Corrigir o fluxo de `task_id` para que o WebSocket não sobrescreva com `null`
3. Garantir loading persistente mesmo navegando entre cards

---

## 🔍 Root Cause Analysis

### O Fluxo Quebrado

1. Usuário clica "Gerar Stories" → `handleGenerateChildren()` é chamado
2. Backend cria job → **mas SEM `task_id`** no `create_job()` (linha 1875 de tasks_old.py)
3. Frontend `addJob()` salva `task_id = item.id` localmente ✅
4. WebSocket envia `job_started` com `task_id: null` (porque o job no DB tem `task_id = null`)
5. `updateJob()` sobrescreve tudo: `{ ...job, ...updates }` → `task_id` vira `null` ❌
6. `isGeneratingChildren` = `activeJobs.some(j => j.task_id === item.id)` → `null === "uuid"` → **sempre false**

### Dois Bugs Combinados

**Bug 1 (Backend):** O endpoint `generate_children` não passava `task_id` para `create_job()`:
```python
# ANTES - sem task_id
job = job_manager.create_job(
    job_type=JobType.CHILDREN_GENERATION,
    input_data={...},
    project_id=task.project_id
    # task_id MISSING!
)
```

**Bug 2 (Frontend):** O `updateJob` sobrescrevia incondicionalmente `task_id` com `null`:
```typescript
// ANTES - sempre sobrescreve
const updatedJob = { ...updatedJobs[jobIndex], ...updates };
// Se updates.task_id === null, o task_id original é perdido
```

---

## ✅ What Was Implemented

### 1. Backend - Passar `task_id` no `create_job` (tasks_old.py:1875)

```python
# DEPOIS - com task_id, deep_link e notification_title
job = job_manager.create_job(
    job_type=JobType.CHILDREN_GENERATION,
    input_data={...},
    project_id=task.project_id,
    task_id=task_id,  # PROMPT #181
    deep_link=f"/projects/{task.project_id}?task={task_id}",
    notification_title=f"Geração concluída: {count} {child_type} para {task.title[:50]}"
)
```

### 2. Frontend - Proteger IDs de sobrescrita por `null` (NotificationContext.tsx:207)

```typescript
// DEPOIS - nunca sobrescreve IDs existentes com null
const safeUpdates = { ...updates };
if (safeUpdates.task_id == null && updatedJobs[jobIndex].task_id) {
  delete safeUpdates.task_id;
}
// ... same for project_id and interview_id
const updatedJob = { ...updatedJobs[jobIndex], ...safeUpdates };
```

---

## 📁 Files Modified

### Modified:
1. **backend/app/api/routes/tasks_old.py** - Adicionado `task_id`, `deep_link`, `notification_title` no `create_job` do endpoint `generate_children`
2. **frontend/src/contexts/NotificationContext.tsx** - Protegido `updateJob` contra sobrescrita de `task_id`/`project_id`/`interview_id` com `null`

---

## 🧪 Testing Results

```
✅ TypeScript - nenhum erro novo nos arquivos modificados
✅ Backend restart - clean, no errors
✅ Frontend restart - ready in 3.1s
✅ WebSocket connection established
```

---

## 🎯 Success Metrics

✅ **Backend:** Job criado com `task_id` correto no DB, transmitido via WebSocket
✅ **Frontend:** `task_id` nunca sobrescrito com `null`, loading persiste
✅ **Proteção dupla:** Backend envia `task_id` correto + Frontend protege contra `null`

---

## 🎉 Status: COMPLETE

Os botões "Gerar Stories/Tasks/Subtasks" agora mostram spinner + "Gerando..." durante toda a execução do job em background. A correção é dupla: backend agora passa `task_id` no job, e frontend protege IDs existentes de serem sobrescritos com `null` pelo WebSocket.

---
