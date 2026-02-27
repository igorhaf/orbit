# PROMPT #302 — Deep Pipeline: Fase 2 Paralela + Crash Recovery

**Data:** 2026-02-27
**Status:** ✅ Implementado

---

## Objetivo

O Deep Pipeline travava com status fantasma no banco após ~5h de execução. A investigação revelou dois problemas distintos: (1) a Fase 2 era sequencial, processando domínios um por vez, tornando sistemas grandes inviáveis; (2) o cleanup de jobs só ocorria no shutdown graceful, não em crashes.

---

## O que Aconteceu (Diagnóstico)

### Status Fantasma
O pipeline **chegou até a Fase 2 e completou todos os 45 domínios**, mas o backend reiniciou durante a execução. Como o cleanup só existia no shutdown graceful, o job ficou permanentemente em `running` com o último progress message salvo ("Analisados 500/523 arquivos").

### Fase 2 Sequencial (gargalo principal)
```python
# ANTES: loop for sequencial — await bloqueante por domínio
for idx, (domain, analyses) in enumerate(domain_groups.items()):
    result = await self.claudio.call(...)  # ~3 min por domínio
```
- 45 domínios × ~3 min = **2.25h só na Fase 2**
- 100 domínios (sistema grande) = **5h só na Fase 2**

---

## O que Foi Implementado

### 1. Fase 2 Paralela via `asyncio.gather` + Semáforo

**Arquivo:** `backend/app/services/deep_pipeline.py`

Extraída a lógica inline do loop para um método `_synthesize_domain()`, e o processamento foi convertido para `asyncio.gather` com semáforo de concorrência configurável por profile.

```python
# DEPOIS: todos os domínios em paralelo com semáforo
semaphore = asyncio.Semaphore(p2_concurrency)  # configurável por profile
tasks = [
    self._synthesize_domain(domain, analyses, ..., semaphore, ...)
    for domain, analyses in valid_domains.items()
]
results = await asyncio.gather(*tasks, return_exceptions=True)
```

**Impacto por volume:**
| Domínios | Antes (sequencial) | Depois (concurrency=5) |
|----------|--------------------|------------------------|
| 45 | ~2.25h | ~27min |
| 100 | ~5h | ~60min |
| 200 | ~10h | ~120min |

Sem cap — todos os domínios são processados, só em paralelo.

### 2. Concorrência por Profile

**Arquivo:** `backend/scripts/seed_pipeline_profiles.py`

`phase_2.concurrency` adicionado nos 3 profiles:

| Profile | `phase_2.concurrency` | Estratégia |
|---------|-----------------------|------------|
| economy | 10 | Máxima velocidade (usa Haiku) |
| balanced | 5 | Equilíbrio custo/velocidade |
| quality | 3 | Conservador (contexto controlado) |

Configurável via API `PUT /pipeline/profiles/{id}` sem alterar código.

### 3. Startup Crash Recovery

**Arquivo:** `backend/app/main.py`

Adicionado cleanup de jobs `RUNNING` **no startup** (além do shutdown já existente):

```python
# Crash recovery no startup (antes do yield)
stale_jobs = startup_db.query(AsyncJob).filter(
    AsyncJob.status == JobStatus.RUNNING
).all()
for job in stale_jobs:
    job.status = JobStatus.FAILED
    job.result = {"error": "Backend reiniciou enquanto job estava em execução (crash recovery)"}
```

Agora cobre tanto shutdown graceful quanto crashes inesperados.

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `backend/app/services/deep_pipeline.py` | Novo método `_synthesize_domain()` + `asyncio.gather` paralelo em `_phase2_rule_synthesis()` |
| `backend/app/main.py` | Startup crash recovery para jobs `RUNNING` |
| `backend/scripts/seed_pipeline_profiles.py` | `phase_2.concurrency` nos 3 profiles (economy:10, balanced:5, quality:3) |

---

## Verificação

1. ✅ `poetry run python -c "from app.services.deep_pipeline import DeepPipelineService"` — sem erros
2. ✅ `poetry run python -c "from app.main import app"` — sem erros
3. ✅ Seed rodado: 3 profiles atualizados com `phase_2.concurrency`
4. ✅ Job fantasma limpo via SQL: `UPDATE async_jobs SET status='failed' WHERE status='running'`
5. ✅ Verificado no DB: `balanced=5`, `economy=10`, `quality=3`
