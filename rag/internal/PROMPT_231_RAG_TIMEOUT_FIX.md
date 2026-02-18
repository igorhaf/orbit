# PROMPT #231 - Fix RAG Extraction Timeouts
## Correção de timeouts na extração de regras de negócio via Ollama

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Performance
**Impact:** Projeto Suinda tinha 234 de 249 arquivos pendentes (0 wiki pages, 0 cards) por timeout na extração.

---

## Objective

Corrigir timeouts que impediam a extração de regras de negócio pelo Ollama, desbloqueando o pipeline incremental (Fases 1-5 do PROMPT #230).

**Key Requirements:**
1. Aumentar timeout por arquivo para acompanhar OLLAMA_TIMEOUT
2. Reduzir paralelismo para respeitar capacidade real da GPU
3. Reduzir batch size para diminuir pressão na fila
4. Limpar jobs zumbis e resetar arquivos falhados

---

## Root Cause Analysis

### Sintomas:
- 8 jobs `rag_continuous_scan` falharam com "Extracao expirou apos 300s"
- 234 de 249 arquivos pendentes
- 0 wiki pages, 0 cards gerados

### Causas:
1. **PER_FILE_TIMEOUT = 300s** (hardcoded) < **OLLAMA_TIMEOUT = 600s** - asyncio cancelava antes do Ollama terminar
2. **MAX_PARALLEL_EXTRACTIONS = 3** mas GPU suporta **OLLAMA_NUM_PARALLEL = 2** - terceiro arquivo esperava na fila e o tempo contava no timeout
3. **batch_size = 30** criava fila de 30 arquivos - últimos nunca processavam a tempo

---

## What Was Implemented

### 1. PER_FILE_TIMEOUT: 300s → 600s (configurável)
```python
# Antes: hardcoded
PER_FILE_TIMEOUT = 300

# Depois: configurável via .env
PER_FILE_TIMEOUT = int(os.getenv("RAG_FILE_TIMEOUT_SECONDS", "600"))
```

### 2. MAX_PARALLEL_EXTRACTIONS: 3 → match GPU
```python
# Antes: hardcoded
MAX_PARALLEL_EXTRACTIONS = 3

# Depois: respeita capacidade real da GPU
MAX_PARALLEL_EXTRACTIONS = int(os.getenv("OLLAMA_NUM_PARALLEL", "2"))
```

### 3. batch_size: 30/50 → 10 (todos os caminhos)
- Default em `batch_processing_cycle()`: 30 → 10
- Default em `submit_batch_processing_cycle()`: 30 → 10
- Mapa por scan_depth: quick=15→8, normal=30→10
- Default em `process_pending_files()`: 50 → 10 (causa raiz do "Arquivo X/30")
- `run_full_cycle()` chamava `process_pending_files()` sem batch_size, usando default 50

### 4. Limpeza de estado
- 8 arquivos falhados resetados para `pending`
- Estado final: 242 pending, 7 completed, 0 failed

---

## Files Modified

### Modified:
1. **backend/app/services/continuous_rag_service.py**
   - Linha 56: MAX_PARALLEL_EXTRACTIONS = 3 → int(os.getenv("OLLAMA_NUM_PARALLEL", "2"))
   - Linha 331: process_pending_files default batch_size = 50 → 10
   - Linha 503: PER_FILE_TIMEOUT = 300 → int(os.getenv("RAG_FILE_TIMEOUT_SECONDS", "600"))

2. **backend/app/services/watchdog.py**
   - Linha 569: default batch_size = 30 → 10
   - Linha 771: default batch_size = 30 → 10
   - Linha 1418: quick=15→8, normal=30→10

---

## Testing Results

```
OK  Syntax valid: continuous_rag_service.py
OK  Syntax valid: watchdog.py
OK  Backend restart: no errors
OK  Ollama processing files immediately after restart
OK  Zombie jobs cleaned: 0 (already completed/failed)
OK  Failed files reset: 8 → pending
OK  File states: 242 pending, 7 completed
```

---

## Key Insights

### 1. asyncio.wait_for vs HTTP timeout
O asyncio.wait_for cancela a coroutine LOCALMENTE mas NÃO cancela a request HTTP ao Ollama. Resultado: GPU continua processando um arquivo "cancelado" enquanto o sistema marca como falha e tenta o próximo. Ambos disputam GPU.

### 2. Semáforo > Capacidade = Timeout Silencioso
Com semáforo de 3 e GPU de 2: terceiro arquivo adquire semáforo mas espera GPU. O tempo de espera na fila do GPU conta no timeout do asyncio.wait_for.

### 3. Dois caminhos de execucao com defaults diferentes
O `process_pending_files()` era chamado por dois caminhos:
- `watchdog.batch_processing_cycle()` → passava `batch_size=10` explicitamente
- `run_full_cycle()` → **nao passava** batch_size, usava default=50
Resultado: jobs do watchdog continuo mostravam "Arquivo X/30" (30 pending files, default 50 buscava todos). Corrigido default para 10.

### 4. Configurabilidade
Tornar timeout e paralelismo configuráveis via .env permite ajustar sem redeployar:
- `RAG_FILE_TIMEOUT_SECONDS=600`
- `OLLAMA_NUM_PARALLEL=2`

---

## Status: COMPLETE

Extração de regras desbloqueada. Pipeline incremental (Fases 1-5) agora pode funcionar.
