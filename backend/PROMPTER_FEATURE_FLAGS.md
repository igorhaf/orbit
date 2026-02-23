# Prompter Feature Flags

Este documento descreve as feature flags disponíveis para controlar a arquitetura Prompter.

## Flags Disponíveis

### `PROMPTER_USE_TEMPLATES`
**Padrão:** `false`
**Quando usar:** Ativa o sistema de templates YAML ao invés de prompts hardcoded

```bash
PROMPTER_USE_TEMPLATES=true
```

**Benefícios:**
- ✅ Templates versionados e reutilizáveis
- ✅ Separação de lógica e conteúdo
- ✅ Facilita iteração em estratégias de prompts
- ✅ Suporte a herança e composição

**Status:** ✅ Estável (Fase 1 completa)

---

### `PROMPTER_USE_STRUCTURED_TEMPLATES`
**Padrão:** `false`
**Dependência:** Requer `PROMPTER_USE_TEMPLATES=true`
**Quando usar:** Ativa templates v2 com formato estruturado ACTION/STEP/EXPECTED_OUTPUT

```bash
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=true
```

**Benefícios:**
- ✅ Comandos imperativos mais previsíveis
- ✅ Estrutura clara (ACTION → STEP 1-N → OUTPUT)
- ✅ Melhor debugging (identificar qual step falhou)
- ✅ Redução de tokens (25-40%)
- ✅ Componentes reutilizáveis

**Templates Disponíveis (v2):**
- `task_generation_v2.yaml` - Geração de tasks (5000 → 3500 tokens, -30%)
- `interview_v2.yaml` - Perguntas de entrevista (2000 → 1500 tokens, -25%)

**Status:** ✅ Implementado (Fase 2 completa)

---

### `PROMPTER_USE_CACHE`
**Padrão:** `false`
**Quando usar:** Ativa sistema de cache multi-nível para reduzir custos

```bash
PROMPTER_USE_CACHE=true
```

**Níveis de Cache:**
1. **Exact Match** (L1) - 7 dias TTL, ~20% hit rate
2. **Semantic Match** (L2) - 1 dia TTL, ~10% hit rate
3. **Template Cache** (L3) - 30 dias TTL, ~5% hit rate

**Cache Hit Rate Esperado:** 30-35%
**Economia Estimada:** 40-60% de redução de custos

**Status:** ✅ Implementado (Fase 3)

---

### `PROMPTER_USE_BATCHING`
**Padrão:** `false`
**Quando usar:** Agrupa requests para reduzir latência

```bash
PROMPTER_USE_BATCHING=true
```

**Configuração:**
- Batch size: 10 requests
- Batch window: 100ms
- Execução paralela: `asyncio.gather`

**Economia Esperada:** 10-20% redução de latência

**Status:** 🚧 Planejado (Fase 3)

---

### `PROMPTER_USE_TRACING`
**Padrão:** `false`
**Quando usar:** Ativa distributed tracing com OpenTelemetry

```bash
PROMPTER_USE_TRACING=true
```

**Ferramentas:**
- OpenTelemetry + Jaeger
- Trace completo: composição → execução → cache → AI call
- Attributes: usage_type, model, cost, tokens, quality_score

**Status:** 🚧 Planejado (Fase 4)

---

## Estratégias de Rollout

### Desenvolvimento Local
Testar novos features sem afetar produção:

```bash
# .env.local
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=true
PROMPTER_USE_CACHE=false  # Redis não configurado localmente
```

### Staging - Canary (10%)
Testar com tráfego real limitado:

```bash
# .env.staging
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=true  # 10% do tráfego via load balancer
PROMPTER_USE_CACHE=true
```

### Production - Gradual Rollout

**Semana 1-2: Canary (10%)**
```bash
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=false  # Ainda usando v1
```

**Semana 3-4: Ramp (50%)**
```bash
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=true  # 50% via feature toggle dinâmico
```

**Semana 5+: Full Rollout (100%)**
```bash
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=true
PROMPTER_USE_CACHE=true
```

---

## Monitoramento

### Métricas Chave

**Antes de habilitar qualquer flag, coletar baseline:**
```bash
# Executar por 1 semana
python -m app.scripts.collect_baseline_metrics
```

**Métricas a monitorar:**
- ✅ Custo por request (target: -40% com cache, -25% com v2 templates)
- ✅ Latência P50/P95/P99 (target: mantém ou melhora)
- ✅ Taxa de erro (target: < 1%)
- ✅ Quality score (target: > 0.85)
- ✅ Cache hit rate (target: > 30%)

### Dashboards

**Prometheus + Grafana:**
```bash
# Ver métricas em tempo real
http://localhost:3001/dashboards

# Métricas principais:
- prompter_executions_total
- prompter_cache_hits_total
- prompter_execution_duration_seconds
- prompter_cost_per_execution_usd
```

---

## Rollback Rápido

Em caso de problemas, desabilitar flags imediatamente:

```bash
# Rollback total
PROMPTER_USE_TEMPLATES=false
PROMPTER_USE_STRUCTURED_TEMPLATES=false
PROMPTER_USE_CACHE=false

# Rollback parcial (manter templates v1)
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=false  # Volta para v1
```

**Tempo de rollback:** < 30 segundos (restart do backend)

---

## Troubleshooting

### Erro: "Template not found"
```bash
# Verificar se templates existem
ls backend/app/prompter/templates/base/

# Se usar v2, verificar se arquivo _v2.yaml existe
ls backend/app/prompter/templates/base/*_v2.yaml
```

### Cache não funcionando
```bash
# Verificar Redis
orbit status redis

# Ver logs do cache
orbit logs backend | grep "cache"
```

### Performance degradada
```bash
# Coletar traces
PROMPTER_USE_TRACING=true

# Analisar no Jaeger
http://localhost:16686
```

---

## Exemplos de Uso

### Exemplo 1: Habilitar v2 templates em dev
```bash
# .env.development
PROMPTER_USE_TEMPLATES=true
PROMPTER_USE_STRUCTURED_TEMPLATES=true

# Restart backend
orbit restart backend

# Testar
curl -X POST http://localhost:8000/api/interviews/{id}/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Sim"}'
```

### Exemplo 2: A/B Testing v1 vs v2
```python
# Em production, usar feature toggle dinâmico
import random

use_v2 = random.random() < 0.5  # 50% v1, 50% v2

os.environ["PROMPTER_USE_STRUCTURED_TEMPLATES"] = str(use_v2).lower()
```

### Exemplo 3: Forçar v1 para usuário específico
```python
# Override temporário
if user.id in BETA_USERS:
    facade = PrompterFacade(db)
    facade.use_structured_templates = True
```

---

## Referências

- **Código:** `backend/app/prompter/facade.py`
- **Templates v1:** `backend/app/prompter/templates/base/*.yaml`
- **Templates v2:** `backend/app/prompter/templates/base/*_v2.yaml`
- **Componentes:** `backend/app/prompter/templates/steps/*.yaml`
- **Testes:** `backend/tests/test_prompter_*.py`
- **Documentação completa:** `PROMPTER_GUIDE.md`

---

## Próximos Passos

1. ✅ Habilitar `PROMPTER_USE_TEMPLATES=true` em dev
2. ✅ Habilitar `PROMPTER_USE_STRUCTURED_TEMPLATES=true` em dev
3. 🔄 Testar por 1 semana, coletar métricas
4. 🔄 Rodar A/B test v1 vs v2 (50/50)
5. 🔄 Se métricas boas, rollout para 100%
6. 🚧 Habilitar cache em staging
7. 🚧 Implementar batching
8. 🚧 Adicionar tracing

**Timeline:** 4-6 semanas para rollout completo
