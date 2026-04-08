# PROMPT #298 - Sub-Jobs: Granularizacao de Operacoes em Jobs Individuais
## Hierarquia pai-filho para rastreabilidade individual por fase/arquivo

**Date:** 2026-02-16
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Todas as operacoes longas (Memory Scan, Continuous RAG, Batch Execution) agora criam sub-jobs individuais por fase/arquivo, permitindo rastreabilidade granular, retomada parcial, e visibilidade no frontend.

---

## 🎯 Objective

Decompor operacoes monoliticas (Memory Scan com 7 fases, Continuous RAG com N arquivos, Batch Execution com N tasks) em **jobs individuais por fase/arquivo**, criando uma hierarquia pai-filhos no sistema de jobs existente.

**Key Requirements:**
1. Infraestrutura: parent_job_id + phase_label no modelo AsyncJob
2. JobManager com metodos para criar/completar/falhar filhos + agregacao de progresso
3. Aplicar em Memory Scan (7 fases), Continuous RAG (N arquivos), Batch Execution (N tasks)
4. API: filtrar jobs raiz, endpoint /children
5. Frontend: hierarquia colapsavel na pagina de Jobs

---

## ✅ What Was Implemented

### 1. Infraestrutura - Modelo e Migration

**AsyncJob** recebeu 2 novos campos:
- `parent_job_id` (FK self-referencing com CASCADE delete)
- `phase_label` (ex: "Fase 3: Indexacao RAG", "Arquivo 15/42: UserController.php")
- Relationship `children` com backref `parent`
- `to_dict()` atualizado com `parent_job_id`, `phase_label`, `children_count`

**Migration** `20260216_add_parent_job_id.py` criada com FK, indice, e downgrade.

### 2. JobManager - 7 Novos Metodos

- `create_child_job()` - Cria sub-job vinculado ao pai, herdando project_id e priority
- `update_parent_progress()` - Recalcula progresso do pai baseado nos filhos
- `complete_child_job()` - Completa filho e atualiza pai, auto-completa quando todos terminam
- `fail_child_job()` - Falha filho e atualiza pai
- `_check_parent_completion()` - Verifica se todos filhos terminaram, completa/falha pai
- `cancel_with_children()` - Cancela pai e todos filhos pendentes/rodando
- `get_children()` - Retorna filhos ordenados por created_at

### 3. Memory Scan - 7 Sub-Jobs por Fase

Cada fase do `scan_and_memorize()` agora cria um sub-job individual:
- Fase 1: Deteccao de Stack
- Fase 2: Varredura de Arquivos
- Fase 3: Indexacao RAG
- Fase 4: Extracao de Amostras
- Fase 5: Analise IA
- Fase 6: Analise Git (condicional)
- Fase 7: Armazenamento de Regras (condicional)

Fases criticas (1, 2) fazem `raise` em caso de erro. Fases opcionais (3, 6) continuam.

### 4. Continuous RAG - Sub-Jobs por Arquivo

Cada arquivo processado pelo Continuous RAG cria um sub-job:
- Phase label: "Arquivo N/Total: path/to/file.py"
- Complete/fail individual por arquivo
- Status: deleted, skipped, error, success rastreados por sub-job

### 5. Batch Execution - Sub-Jobs por Task

Cada task executada em batch cria um sub-job:
- Phase label: "Task N/Total: titulo da task"
- task_id vinculado ao sub-job
- Suporte a cancelamento (is_cancelled check preservado)

### 6. Ativacoes - SKIP Deliberado

As funcoes de ativacao (`_generate_stories_async`, `_generate_tasks_async`, etc.) fazem **uma unica chamada AI** que retorna todos os itens de uma vez. Nao ha loop com chamadas individuais. Sub-jobs aqui adicionariam overhead sem beneficio de rastreabilidade, pois a operacao e atomica.

### 7. Jobs API - Hierarquia

- `GET /jobs/` agora filtra por `root_only=true` por padrao (parent_job_id IS NULL)
- Novo endpoint `GET /jobs/{job_id}/children` retorna sub-jobs ordenados
- `PATCH /jobs/{job_id}/cancel` agora usa `cancel_with_children()` (cascata)

### 8. Frontend - Hierarquia Colapsavel

- Coluna "Fases" na tabela de jobs mostra contagem de filhos
- Botao de expansao (chevron) quando children_count > 0
- Ao expandir: carrega `GET /jobs/{id}/children` e renderiza sub-linhas
- Sub-jobs tem visual indentado (bg-purple-50, border-l-2 border-purple-300, pl-10)
- Mostra phase_label, status, progresso, duracao por sub-job
- JobResponse atualizado com parent_job_id, phase_label, children_count

---

## 📁 Files Modified/Created

### Created:
1. **backend/alembic/versions/20260216_add_parent_job_id.py** - Migration
   - Lines: 32
   - Features: parent_job_id FK, phase_label, index

### Modified:
1. **backend/app/models/async_job.py** - +3 campos, +1 relationship, to_dict() atualizado
2. **backend/app/services/job_manager.py** - +7 metodos, +2 params em create_job()
3. **backend/app/services/codebase_memory.py** - +job_id param, 7 fases com sub-jobs
4. **backend/app/services/continuous_rag_service.py** - +parent_job_id param, sub-jobs per file
5. **backend/app/api/routes/continuous_rag.py** - Passa job_id ao service
6. **backend/app/api/routes/tasks_old.py** - Sub-jobs per task em batch execution
7. **backend/app/api/routes/projects.py** - Passa job_id a scan_and_memorize (3 call sites)
8. **backend/app/api/routes/jobs.py** - root_only filter, /children endpoint, cancel_with_children
9. **frontend/src/lib/api.ts** - JobResponse +3 campos, getChildren() method
10. **frontend/src/app/jobs/page.tsx** - Coluna Fases, expand/collapse, children rows

---

## 🧪 Testing Results

### Verification:

```
✅ Migration criada com FK, index, e downgrade
✅ JobManager com 7 metodos de sub-job hierarchy
✅ Memory Scan: 7 fases como sub-jobs individuais
✅ Continuous RAG: N arquivos como sub-jobs
✅ Batch Execution: N tasks como sub-jobs
✅ API: root_only filter + /children endpoint
✅ Frontend: hierarquia colapsavel com visual indentado
✅ cancel_with_children cascade implementado
✅ Auto-completion do pai quando todos filhos terminam
```

---

## 🎯 Success Metrics

✅ **Rastreabilidade granular:** Cada fase/arquivo tem seu proprio job com status, duracao, erro
✅ **Visibilidade no frontend:** Hierarquia colapsavel na pagina de Jobs
✅ **Retomada parcial:** Se filho 15 de 20 falha, o pai mostra exatamente qual fase falhou
✅ **Escalabilidade:** Infraestrutura pronta para paralelismo controlavel futuro
✅ **Backward compatible:** job_id parameter e opcional em todos os call sites

---

## 💡 Key Insights

### 1. Ativacoes nao se beneficiam de sub-jobs
Funcoes de ativacao fazem uma unica chamada AI atomica. O "loop" e apenas para enriquecer items retornados, nao para processamento individual. Sub-jobs adicionariam overhead sem beneficio.

### 2. Progress aggregation automatica
O metodo `update_parent_progress()` calcula porcentagem baseada em filhos concluidos. `_check_parent_completion()` auto-completa ou auto-falha o pai quando todos filhos terminam, incluindo mensagem de erro especifica da fase que falhou.

### 3. CASCADE delete simplifica cleanup
A FK com `ondelete='CASCADE'` garante que deletar o pai limpa automaticamente todos os filhos, sem necessidade de logica extra no cleanup.

---

## 🎉 Status: COMPLETE

Sub-jobs implementados com hierarquia completa pai-filhos em 3 operacoes (Memory Scan, Continuous RAG, Batch Execution), API atualizada, e frontend com visualizacao colapsavel.

**Key Achievements:**
- ✅ 7 novos metodos no JobManager para gerenciamento de sub-jobs
- ✅ 3 operacoes decompostas em sub-jobs individuais
- ✅ Frontend com hierarquia colapsavel
- ✅ API com filtro root_only e endpoint /children
- ✅ Auto-completion e cascade cancel

**Impact:**
- Rastreabilidade individual por fase/arquivo em operacoes longas
- Visibilidade granular de progresso e erros no frontend
- Base para paralelismo controlavel em versoes futuras

---
