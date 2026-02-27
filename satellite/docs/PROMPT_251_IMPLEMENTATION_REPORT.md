# PROMPT #251 - Manual RAG Scan (Remove Continuous Scan)
## Migração de scan automático contínuo para disparo manual por botão

**Date:** 2026-02-21
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Refactor / UX Improvement
**Impact:** Elimina watchdog loop infinito, scan de documentos agora é sob demanda via botão

---

## 🎯 Objective

Remover o scan contínuo automático (watchdog + batch_processing_cycle) que rodava
em loop infinito, criando jobs fantasmas e bloqueando a geração de cards.
Substituir por um botão "Scan Documentos" que o usuário dispara manualmente.

**Key Requirements:**
1. Remover auto-trigger do `batch_processing_cycle` após `_process_initial_scan`
2. Remover auto-requeue do `watchdog_cycle` (loop infinito)
3. Remover bootstrap automático do watchdog no startup do servidor
4. Manter o endpoint manual `POST /rag/scan` já existente
5. Adicionar botão "Scan Documentos" no frontend
6. Atualizar `rag_completed` para não depender de `pending_files == 0`

---

## ✅ What Was Implemented

### 1. Removido Auto-Trigger do Pipeline Inicial

**`backend/app/services/project_service.py`**
- Removido bloco que chamava `scan_for_changes()` + `submit_batch_processing_cycle()`
  após `_process_initial_scan()` completar
- Removida transição para `submit_watchdog_cycle()` no modo deep scan
- Pipeline agora termina no memory scan — RAG indexing é manual

### 2. Removido Watchdog Auto-Requeue

**`backend/app/services/watchdog.py`**
- `watchdog_cycle()`: Removido sleep + `submit_watchdog_cycle()` ao final
- `watchdog_cycle()`: Removido re-queue automático em caso de falha
- `batch_processing_cycle()`: Removido `submit_watchdog_cycle()` após processar todos os arquivos
- `batch_processing_cycle()`: Removido `submit_watchdog_cycle()` quando zero arquivos
- `batch_processing_cycle()`: Removido auto-requeue em caso de falha

### 3. Removido Bootstrap no Startup

**`backend/app/services/watchdog.py`**
- Removido bloco que re-submetia orphaned jobs no startup
- Removido loop que criava watchdog/batch para todos os projetos ativos
- Bootstrap agora apenas limpa zombie jobs (comportamento existente mantido)

### 4. Atualizado `rag_completed`

**`backend/app/api/routes/continuous_rag.py`**
- `rag_completed` agora é `initial_scan_complete AND NOT is_enriching`
- Removida dependência de `pending_files == 0` (scan é manual agora)

### 5. Botão "Scan Documentos" no Frontend

**`frontend/src/app/projects/[id]/page.tsx`**
- Botão persistente no header do projeto (ao lado do título)
  - Visível quando `initialScanComplete && !isEnriching`
  - Ícone de lupa, estilo outline cinza
  - Chama `ragApi.continuousScan(projectId)`
  - Feedback via `showSuccess`/`showError`
- Botão adicional no banner verde (pré-cards)
  - Ao lado do "Gerar Cards", estilo outline
  - Mesma funcionalidade

---

## 📁 Files Modified

### Modified:
1. **backend/app/services/project_service.py** — Removido auto-trigger de batch/watchdog
2. **backend/app/services/watchdog.py** — Removido auto-requeue e bootstrap automático
3. **backend/app/api/routes/continuous_rag.py** — Atualizado rag_completed
4. **frontend/src/app/projects/[id]/page.tsx** — Botão "Scan Documentos"

---

## 🧪 Testing Results

```bash
✅ Frontend build: sucesso (npx next build)
✅ Jobs fantasmas limpos no banco (2 pendentes → completed)
✅ Botão visível no header e no banner verde
✅ Endpoint POST /rag/scan mantido funcional
✅ rag_completed não depende mais de pending_files
```

---

## 🎯 Success Metrics

✅ **Zero loops infinitos:** Watchdog e batch não re-enfileiram automaticamente
✅ **Scan sob demanda:** Usuário decide quando escanear
✅ **Cards desbloqueados:** rag_completed não trava por pending_files
✅ **UX clara:** Botão sempre visível com feedback

---

## 💡 Key Insights

### 1. Continuous scan causava mais problemas do que resolvia
O watchdog rodava a cada 60-300s, criando centenas de jobs que ficavam stuck
quando o backend reiniciava, bloqueando a geração de cards indefinidamente.

### 2. Scan manual é mais previsível
O usuário sabe exatamente quando novos documentos foram adicionados e pode
disparar o scan quando necessário, sem overhead contínuo.

---

## 🎉 Status: COMPLETE

Pipeline de scan RAG migrado de automático/contínuo para manual/sob-demanda.
Watchdog loop infinito eliminado. Botão "Scan Documentos" disponível na página do projeto.
