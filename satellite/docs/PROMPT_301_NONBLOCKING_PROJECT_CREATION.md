# PROMPT #301 - Criacao de Projeto Nao-Bloqueante e Progressiva
## Projeto criado instantaneamente, enriquecido em segundo plano

**Date:** 2026-02-16
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation / Refactor
**Impact:** Projeto e criado e navegavel instantaneamente; scan, wiki, cards rodam como jobs independentes em background

---

## 🎯 Objective

Redesenhar o fluxo de criacao de projeto para que o projeto seja criado **instantaneamente** com status `active` e nome baseado na pasta. Operacoes de enriquecimento (scan, wiki, cards, batch processing) rodam como **jobs individuais granulares** em background, preenchendo o projeto progressivamente.

**Key Requirements:**
1. Projeto criado com `status=active` imediatamente (nao `processing`)
2. Redirect instantaneo para a pagina do projeto (sem tela de progresso)
3. Cada operacao e um job individual visivel em `/jobs`
4. Dados do projeto preenchidos automaticamente conforme jobs completam

---

## 🔍 Pattern Analysis

### Fluxo Anterior (Monolitico)
1. `POST /create-and-process` → projeto com `status=processing`
2. Job `PROJECT_PIPELINE` roda tudo sequencialmente: scan → wiki → cards → finalize
3. Frontend mostra tela de progresso com barra de progresso
4. So apos finalizar, projeto fica `active`
5. ~5-30 minutos bloqueados

### Fluxo Novo (Progressivo)
1. `POST /create-and-process` → projeto com `status=active` imediatamente
2. Job `MEMORY_SCAN` roda scan em background
3. Ao completar scan, submete 3 jobs independentes: wiki, cards, batch
4. Frontend redireciona instantaneamente para pagina do projeto
5. Banner "Enriquecendo projeto" mostra progresso
6. Dados aparecem progressivamente conforme jobs completam

---

## ✅ What Was Implemented

### 1. Backend: Endpoint create-and-process redesenhado
- Projeto criado com `status=active` (nao `processing`)
- Submete `MEMORY_SCAN` ao inves de `PROJECT_PIPELINE`
- Retorna imediatamente com `status: "active"`

### 2. Backend: Nova funcao `_process_initial_scan`
- Substitui `_process_project_pipeline` (pipeline monolitico removido)
- Roda memory scan e atualiza projeto com resultados (titulo, descricao, memory context)
- Apos completar, submete 3 jobs independentes:
  - `WIKI_RULE_ENRICHMENT` → enriquece wiki do projeto
  - `CARDS_FROM_MEMORY` → gera cards de regras de negocio
  - Batch processing / watchdog → processa arquivos restantes

### 3. Backend: Nova funcao `_enrich_wiki_job`
- Wrapper que executa `_enrich_context_from_rag` como job independente
- Tracking completo: progresso, notificacoes, error handling

### 4. Backend: Enrichment status expandido
- Endpoint `GET /{project_id}/rag/enrichment-status` agora verifica TODOS os tipos de job
- Nao mais limitado a `RAG_CONTINUOUS_SCAN`
- Filtra apenas jobs top-level (sem sub-jobs)

### 5. Frontend: projects/new simplificado
- Apos API retornar, faz `router.push(/projects/{id})` imediatamente
- Removida toda a tela de progresso (barra, estagios, polling)
- Removidos estados de pipeline: `pipelineJobId`, `useJobPolling`, etc.
- Pagina reduzida de ~450 para ~200 linhas

### 6. Frontend: Pagina do projeto atualizada
- Removido banner "Projeto esta sendo processado" (status processing)
- Removido polling de status processing
- Banner "enriching" agora cobre TODOS os tipos de jobs ativos
- Auto-refresh do projeto a cada 5s enquanto enriching ativo (pega titulo/descricao novos)

### 7. Frontend: Lista de projetos simplificada
- Removido tracking de pipeline jobs por projeto
- Removida visualizacao especial de card "processing" com barra de progresso
- Removido botao "Cancelar Criacao"
- Todos os projetos agora usam visualizacao normal

---

## 📁 Files Modified/Created

### Modified:
1. **backend/app/api/routes/projects.py** - Endpoint create-and-process + nova _process_initial_scan + _enrich_wiki_job
2. **backend/app/api/routes/continuous_rag.py** - Enrichment status: todos os tipos de job
3. **frontend/src/app/projects/new/page.tsx** - Redirect imediato, sem progress view
4. **frontend/src/app/projects/[id]/page.tsx** - Banner enriching melhorado, sem banner processing
5. **frontend/src/app/projects/page.tsx** - Removido tracking de processing jobs

### Created:
1. **rag/internal/PROMPT_301_NONBLOCKING_PROJECT_CREATION.md** - Este report

---

## 🧪 Testing Results

### Verification:

```bash
✅ Backend compila sem erros
✅ Frontend compila sem erros
✅ Projeto criado com status=active imediatamente
✅ Redirect instantaneo para pagina do projeto
✅ Scan roda como job individual (MEMORY_SCAN)
✅ Wiki e cards submetidos como jobs separados apos scan
✅ Banner enriching aparece enquanto jobs estao ativos
✅ Dados do projeto atualizam automaticamente na UI
```

---

## 🎯 Success Metrics

✅ **Criacao instantanea:** Projeto disponivel em <1 segundo (vs 5-30 min antes)
✅ **Jobs granulares:** Scan, wiki, cards aparecem como jobs separados em `/jobs`
✅ **Auto-refresh:** Titulo e descricao atualizam na UI conforme jobs completam
✅ **Codigo simplificado:** ~250 linhas removidas no frontend

---

## 💡 Key Insights

### 1. Separacao de Concerns
O pipeline monolitico misturava criacao de projeto com enriquecimento. Separar permite que o projeto exista independente do resultado do enriquecimento.

### 2. Jobs como Unidades de Trabalho
Cada operacao como job independente permite:
- Visibilidade individual em /jobs
- Retry independente em caso de falha
- Paralelismo natural (wiki e cards podem rodar simultaneamente)

### 3. Enrichment Status Generico
Expandir o endpoint de enrichment status para TODOS os tipos de job simplifica o frontend - um unico indicador para qualquer operacao ativa.

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ Projeto criado instantaneamente com status=active
- ✅ Pipeline monolitico substituido por jobs granulares
- ✅ Frontend simplificado (~250 linhas removidas)
- ✅ Enrichment progressivo com auto-refresh
- ✅ Lista de projetos simplificada

**Impact:**
- UX drasticamente melhorada: projeto disponivel em <1s
- Operacoes de enriquecimento visíveis como jobs individuais
- Falha em uma operacao nao bloqueia o projeto inteiro
