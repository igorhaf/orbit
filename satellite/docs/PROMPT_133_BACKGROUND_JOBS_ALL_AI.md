# PROMPT #133 - Background Jobs for ALL AI Operations
## Notificações com Deep Links para Navegação

**Date:** February 1, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** UI livre para navegação durante operações de IA - notificações no sininho para sucesso E erros

---

## Objective

Mover **todas as operações de IA** para background jobs, permitindo que o usuário navegue livremente enquanto as operações processam. Ao completar (sucesso ou erro), uma notificação aparece no sininho com deep linking para o local correto.

**Key Requirements:**
1. Entrevistas rodam em background (já existia, adaptado)
2. Memory Scan em background com notificação
3. Context Generation em background com notificação
4. Notificações para SUCESSO e ERRO
5. Deep links navegam para a tela correta
6. Wizard de projeto adaptado para jobs

---

## What Was Implemented

### 1. Backend: Novos Job Types e Campos

**Arquivo:** `backend/app/models/async_job.py`

Adicionados novos JobTypes:
- `INTERVIEW_QUESTION` - Geração de pergunta de entrevista
- `MEMORY_SCAN` - Análise de codebase (scan memory)
- `PROJECT_TITLE` - Geração de título do projeto
- `CONTEXT_GENERATION` - Geração de contexto do projeto
- `SUGGESTED_EPICS` - Geração de épicos sugeridos

Adicionados novos campos para deep linking:
- `task_id` - UUID opcional para operações em cards
- `deep_link` - URL para navegar quando notificação clicada
- `notification_title` - Título dinâmico (atualizado com sucesso/erro)

### 2. Backend: Job Manager Atualizado

**Arquivo:** `backend/app/services/job_manager.py`

Método `create_job()` expandido para aceitar:
- `task_id` - ID do card relacionado
- `deep_link` - URL de navegação
- `notification_title` - Título para exibição

### 3. Backend: Endpoint de Entrevistas

**Arquivo:** `backend/app/api/routes/interviews/endpoints.py`

- `send_message_async` agora usa `JobType.INTERVIEW_QUESTION`
- Constrói `deep_link` baseado em task_id ou interview_id
- `_process_interview_message_async` atualiza `notification_title`:
  - Sucesso: "Pergunta gerada para 'Nome do Card'"
  - Erro: "Erro ao gerar pergunta: {mensagem}"

### 4. Backend: Memory Scan em Background

**Arquivo:** `backend/app/api/routes/projects.py`

- Endpoint `/scan-memory` agora retorna `job_id` imediatamente
- Nova função `_process_memory_scan_async` executa em background
- Deep link: `/projects/new?projectId={id}&step=1`
- Notificação de sucesso: "Análise concluída: '{titulo_sugerido}'"
- Notificação de erro: "Erro na análise: {mensagem}"

### 5. Backend: Context Generation em Background

**Arquivo:** `backend/app/api/routes/interviews/endpoints.py`

- Endpoint `/generate-context` agora retorna `job_id` imediatamente
- Nova função `_process_context_generation_async` executa em background
- Deep link: `/projects/new?projectId={id}&step=3`
- Notificação de sucesso: "Contexto gerado para '{nome}' - {n} épicos sugeridos"
- Notificação de erro: "Erro ao gerar contexto: {mensagem}"

### 6. Frontend: NotificationContext Expandido

**Arquivo:** `frontend/src/contexts/NotificationContext.tsx`

Interface `JobNotification` expandida:
- `deep_link` - URL para navegação
- `notification_title` - Título dinâmico
- `project_id`, `task_id`, `interview_id` - IDs relacionados

Novos job types mapeados:
- `interview_question`: "Gerando Pergunta"
- `memory_scan`: "Analisando Código"
- `project_title`: "Gerando Título"
- `context_generation`: "Gerando Contexto"
- `suggested_epics`: "Gerando Épicos"

`pollJobs` atualizado para incluir deep_link e notification_title da API.

### 7. Frontend: NotificationBell com Navegação

**Arquivo:** `frontend/src/components/ui/NotificationBell.tsx`

- Importado `useRouter` do Next.js
- Nova função `handleNotificationClick`:
  - Marca como lida
  - Fecha dropdown
  - Navega para `deep_link` se disponível

### 8. Frontend: Wizard Adaptado

**Arquivo:** `frontend/src/app/projects/new/page.tsx`

Memory Scan:
- Estado `memoryScanJobId` para polling
- `handleFolderSelect` cria job e registra no NotificationContext
- `useJobPolling` monitora conclusão
- `handleMemoryScanComplete` processa resultado

Context Generation:
- Estado `contextJobId` para polling
- `handleInterviewComplete` cria job e registra no NotificationContext
- `useJobPolling` monitora conclusão
- `handleContextJobComplete` processa resultado e avança wizard

### 9. Database Migration

**Arquivo:** `backend/alembic/versions/20260201000001_add_async_job_fields_prompt133.py`

Adiciona colunas na tabela `async_jobs`:
- `task_id` (UUID, nullable, indexed)
- `deep_link` (String 500, nullable)
- `notification_title` (String 200, nullable)

---

## Files Modified/Created

### Backend:
1. `backend/app/models/async_job.py` - Novos JobTypes e campos
2. `backend/app/services/job_manager.py` - Parâmetros expandidos
3. `backend/app/api/routes/interviews/endpoints.py` - Background interview e context
4. `backend/app/api/routes/projects.py` - Background memory scan
5. `backend/alembic/versions/20260201000001_add_async_job_fields_prompt133.py` - Migration

### Frontend:
1. `frontend/src/contexts/NotificationContext.tsx` - Deep links e novos tipos
2. `frontend/src/components/ui/NotificationBell.tsx` - Navegação via router
3. `frontend/src/app/projects/new/page.tsx` - Jobs para scan e context

---

## Deep Links por Operação

| Operação | Deep Link | Destino |
|----------|-----------|---------|
| Interview Question | `/projects/{id}?task={taskId}&tab=interview` | ItemDetailPanel na aba Interview |
| Memory Scan | `/projects/new?projectId={id}&step=1` | Wizard na fase 1 |
| Context Generation | `/projects/new?projectId={id}&step=3` | Wizard na fase 3 (review) |
| Epic Activation | `/projects/{id}?task={epicId}` | ItemDetailPanel do epic |

---

## Notificações: Formato

### Sucesso
- "Pergunta gerada para 'Login OAuth'"
- "Análise concluída: 'E-commerce Platform'"
- "Contexto gerado para 'MeuProjeto' - 12 épicos sugeridos"

### Erro
- "Erro ao gerar pergunta: Rate limit exceeded"
- "Erro na análise: Pasta não encontrada"
- "Erro ao gerar contexto: Timeout"

---

## Fluxo de Exemplo

```
1. Usuário seleciona pasta no wizard
2. Sistema cria job MEMORY_SCAN
3. Usuário pode SAIR do wizard e navegar livremente

4. [Background] Job analisa codebase
5. [Background] Job completa → Notificação no sininho
6. Notificação: "Análise concluída: 'MeuProjeto'"

7. Usuário clica na notificação
8. Sistema navega para /projects/new?projectId=xxx&step=1
9. Wizard mostra título sugerido e stack detectada
```

---

## Status: COMPLETE

**Todas as fases implementadas:**
- Fase 1: Novos JobTypes
- Fase 2: Endpoint de entrevistas
- Fase 3: Memory Scan em background
- Fase 4: Context Generation em background
- Fase 5: ChatInterface adaptado (já usava jobs)
- Fase 6: Deep links nas notificações
- Fase 7: Wizard adaptado para background

**Resultado:**
| Antes | Depois |
|-------|--------|
| Operações de IA bloqueiam UI | UI livre para navegação |
| Usuário espera na mesma tela | Usuário trabalha em paralelo |
| Sem feedback se sair | Notificações para sucesso E erros |
| Erros perdem contexto | Erros com deep link para correção |
