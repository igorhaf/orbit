# PROMPT #128 - Background Job Notifications
## Sistema de Notificações para Jobs em Background

**Date:** January 31, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** UX improvement - users can track AI generation progress via notification bell

---

## Objective

Implementar um sistema de notificações no header para acompanhar jobs de geraçao de IA executando em background. Todas as gerações de texto por IA (exceto entrevistas) devem ser assíncronas, e o usuário deve ser notificado via sininho quando completarem.

**Key Requirements:**
1. Sininho de notificações no header (lado direito, antes de Settings)
2. Badge com contagem de jobs ativos + notificações não lidas
3. Dropdown mostrando jobs em andamento (com progress bar) e histórico
4. Integração com sistema de jobs existente (AsyncJob)
5. Auto-polling para atualizar status dos jobs

---

## What Was Implemented

### 1. NotificationProvider (Context Global)
- Gerencia estado global de notificações
- Rastreia jobs ativos (polling automático)
- Mantém histórico de notificações (últimas 50)
- Métodos: `addJob`, `updateJob`, `markAsRead`, `clearNotification`

### 2. NotificationBell Component
- Ícone de sino no header
- Badge vermelho com contagem (ativos + não lidos)
- Indicador pulsante azul quando há jobs em andamento
- Dropdown com seções:
  - "Em andamento" - jobs ativos com progress bar
  - "Histórico" - notificações completadas/falhas
- Estado vazio elegante quando não há notificações

### 3. ClientProviders Wrapper
- Wrapper client-side para providers
- Mantém layout como Server Component
- Envolve toda a aplicação com NotificationProvider

### 4. Backend: GET /jobs/active
- Novo endpoint para listar jobs ativos (pending/running)
- Usado pelo frontend para carregar jobs ao iniciar

### 5. Integration with Job Flows
- TaskCard, ItemDetailPanel, BacklogListView agora registram jobs nas notificações
- Quando ativação de card é iniciada, aparece no sininho
- Quando completa/falha, permanece no histórico

---

## Files Created

| File | Lines | Description |
|------|-------|-------------|
| [NotificationContext.tsx](frontend/src/contexts/NotificationContext.tsx) | 254 | Context global para notificações |
| [NotificationBell.tsx](frontend/src/components/ui/NotificationBell.tsx) | 270 | Componente do sininho com dropdown |
| [ClientProviders.tsx](frontend/src/components/providers/ClientProviders.tsx) | 20 | Wrapper para providers client-side |
| [useJobWithNotification.ts](frontend/src/hooks/useJobWithNotification.ts) | 90 | Hook opcional para jobs com notificação |

## Files Modified

| File | Changes |
|------|---------|
| [Navbar.tsx](frontend/src/components/layout/Navbar.tsx) | Added NotificationBell component |
| [layout.tsx](frontend/src/app/layout.tsx) | Wrapped with ClientProviders |
| [jobs.py](backend/app/api/routes/jobs.py) | Added GET /jobs/active endpoint |
| [TaskCard.tsx](frontend/src/components/backlog/TaskCard.tsx) | Integrated notification tracking |
| [ItemDetailPanel.tsx](frontend/src/components/backlog/ItemDetailPanel.tsx) | Integrated notification tracking |
| [BacklogListView.tsx](frontend/src/components/backlog/BacklogListView.tsx) | Integrated notification tracking |
| [index.ts](frontend/src/components/ui/index.ts) | Exported NotificationBell |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         NAVBAR                                  │
│  [ORBIT Logo]                          [🔔 Badge] [⚙️ Settings] │
└─────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NOTIFICATION DROPDOWN                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Em andamento (2)                                          │ │
│  │  🧠🏗️ Ativando epic: Login System... [████████░░] 80%    │ │
│  │  🧠🏗️ Ativando story: User auth...   [██░░░░░░░░] 20%    │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Histórico                                                 │ │
│  │  🧠🏗️ Epic ativado: Dashboard     ✓ Concluído      2m   │ │
│  │  🧠🏗️ Story ativado: Charts       ✗ Falhou         5m   │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

```
1. User clicks "Activate" on Epic
   │
   ▼
2. tasksApi.activateSuggestedEpic(id)
   │
   ▼
3. Backend creates AsyncJob, returns { job_id }
   │
   ▼
4. Frontend calls addJob(job_id, "epic_activation", title)
   │
   ▼
5. NotificationProvider starts polling GET /jobs/{job_id}
   │
   ▼
6. Badge shows "1" active job
   │
   ▼
7. Job completes → moves to notifications history
   │
   ▼
8. User clicks bell → sees completion status
```

---

## Job Type Icons (from AIModelBadge)

| Job Type | Icon | Description |
|----------|------|-------------|
| interview_message | 🧠🔍 | IA Investigativa / RAG |
| backlog_generation | 🧠🧩 | Raciocínio Complexo |
| epic_activation | 🧠🏗️ | Inteligência Arquitetada |
| story_activation | 🧠🏗️ | Inteligência Arquitetada |
| task_activation | 🧠🏗️ | Inteligência Arquitetada |
| subtask_activation | 🧠🏗️ | Inteligência Arquitetada |
| task_execution | 🛠️🤖 | IA Construtora / Geradora |
| commit_generation | 🧩⚙️ | Engine Inteligente |

---

## Testing

### Manual Verification:
```
✅ NotificationBell appears in navbar (left of Settings)
✅ Empty state shows when no notifications
✅ Badge count updates when jobs are added
✅ Pulsing indicator when jobs are running
✅ Dropdown shows active jobs with progress bars
✅ Dropdown shows completed notifications in history
✅ Click notification marks as read (removes blue dot)
✅ "Clear" button removes all notifications
✅ Dev server compiles without errors
```

---

## Success Metrics

✅ **Sininho visível** no header, lado direito
✅ **Badge com contagem** de jobs ativos + não lidos
✅ **Progress bar** para jobs em andamento
✅ **Histórico** de notificações completadas
✅ **Integração** com fluxos de ativação de cards
✅ **Polling automático** a cada 2 segundos

---

## Usage Example

```typescript
// In any component that starts a background job:
import { useNotifications } from '@/contexts/NotificationContext';

const { addJob } = useNotifications();

// When starting a job:
const result = await tasksApi.activateSuggestedEpic(item.id);
if (result.job_id) {
  addJob(
    result.job_id,
    'epic_activation',
    `Ativando epic: ${item.title.substring(0, 30)}...`,
    item.title
  );
}
```

---

## Status: COMPLETE

O sistema de notificações foi implementado com sucesso. Agora todas as gerações de IA em background (ativação de cards, geração de backlog, etc.) aparecem no sininho do header, permitindo ao usuário acompanhar o progresso sem bloquear a interface.

**Key Achievements:**
- Sininho de notificações implementado no header
- Badge com contagem de jobs ativos
- Progress bars para jobs em andamento
- Histórico de notificações
- Integração com sistema de jobs existente
- Polling automático para atualizações em tempo real

**Impact:**
- UX melhorada - usuário pode continuar navegando enquanto IA processa
- Transparência - usuário vê progresso das operações de IA
- Consistência - todas as operações de IA usam o mesmo padrão

---
