#!/usr/bin/env python3
"""
Enrich Phase 2 - Block 1: Create 10 new wiki pages for undocumented subsystems.
Each page documents a real subsystem found in the codebase but missing from the wiki.
Anti-duplication: checks slug existence before creating.
"""
import uuid
import json
import psycopg2
import requests
from datetime import datetime

DB = "dbname=orbit user=orbit password=orbit_password host=localhost"
PROJECT_ID = "7cc16429-1a4e-44a1-873c-dfa0368625c8"
OLLAMA_URL = "http://172.27.144.1:11434"
WIKI_DIR = "satellite/knowledge/wiki"

def get_embedding(text: str) -> list:
    resp = requests.post(f"{OLLAMA_URL}/api/embeddings", json={
        "model": "nomic-embed-text",
        "prompt": text[:2000]
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]

def make_wiki_id(slug: str) -> str:
    return str(uuid.uuid5(uuid.UUID(PROJECT_ID), slug))

NOW = datetime.utcnow().isoformat()

NEW_WIKI_PAGES = [
    {
        "slug": "utility-nodes",
        "title": "Utility Nodes no AI Flow",
        "order_index": 25,
        "content": """# Utility Nodes no AI Flow

## O que são Utility Nodes

Utility Nodes são componentes plugáveis inseridos no pipeline de execução do AI Flow. Eles encapsulam lógica cross-cutting que deve ocorrer antes (PRE) ou depois (POST) de cada chamada de IA — sem modificar o código do AIOrchestrator ou dos serviços de domínio.

**Implementação:** `backend/app/services/utility_node_executor.py`

## Tipos de Utility Nodes

### PRE-execution Nodes
Executados antes da chamada de IA:

| Node | Função | Impacto |
|------|--------|---------|
| `cache_check` | Verifica L1/L2/L3 antes de chamar a API | 30-35% economia de tokens |
| `rag_enrichment` | Injeta contexto semântico do RAG no prompt | Reduz tokens necessários |
| `prompt_transform` | Aplica templates e substituições Jinja2 | Normaliza prompts |
| `router` | Seleciona o modelo adequado por usage_type | Otimiza custo/qualidade |
| `rate_limiter` | Aplica throttling por modelo configurado | Previne rate limit 429 |
| `cost_guard` | Verifica orçamento antes de executar | Previne estouro de budget |

### POST-execution Nodes
Executados após a chamada de IA:

| Node | Função | Impacto |
|------|--------|---------|
| `validator` | Valida formato e completude da resposta | Garante qualidade |
| `retry` | Re-executa em caso de falha transiente | Resiliência |
| `cache_storage` | Armazena resultado no cache multi-nível | Alimenta futuros hits |

## Configuração via AI Flow Studio

No AI Flow Studio (`/ai-flow`), cada node pode ser ativado/desativado por perfil:

```yaml
# Exemplo de perfil com utility nodes
profile_name: "cost_optimized"
utility_nodes:
  pre:
    - cache_check        # Sempre primeiro
    - rag_enrichment     # Enriquece contexto
    - router             # Seleciona modelo
    - rate_limiter       # Protege APIs
  post:
    - validator          # Valida resposta
    - cache_storage      # Guarda no cache
```

## Fluxo de Execução

```
Request → [PRE: cache_check] → CACHE HIT? → Return cached
                             ↓ MISS
          [PRE: rag_enrichment] → Enrich prompt
          [PRE: router] → Select model
          [PRE: rate_limiter] → Check limits
          [PRE: cost_guard] → Check budget
          → AI API Call
          [POST: validator] → Valid? → Return
                            ↓ Invalid
          [POST: retry] → Retry (max 3)
          [POST: cache_storage] → Store result
          → Return response
```

## Relação com Outros Sistemas

- **Cache Multi-Nível:** `cache_check` e `cache_storage` são os nodes de integração
- **Rate Limiting:** O node `rate_limiter` usa `RateLimiterService` com sliding window Redis
- **RAG Pipeline:** O node `rag_enrichment` faz busca semântica em `rag_documents`
- **Budget Manager:** O node `cost_guard` consulta `budget_manager.py` antes de executar
"""
    },
    {
        "slug": "error-classification",
        "title": "Classificação de Erros e Fallback Inteligente",
        "order_index": 26,
        "content": """# Classificação de Erros e Fallback Inteligente

## Visão Geral

O sistema classifica automaticamente exceções em 3 categorias para determinar a estratégia de fallback ideal: tentar outro modelo, aguardar e tentar novamente, ou falhar imediatamente.

**Implementação:** `backend/app/services/error_classifier.py`

## Categorias de Erros

### 🔴 Permanent (Falha Imediata)
Erros que indicam problema de configuração ou autorização — retry não vai resolver:

- `401 Unauthorized` — API key inválida ou expirada
- `403 Forbidden` — Sem permissão para o recurso
- `404 Not Found` — Modelo não existe
- `model_not_found` — Modelo configurado não disponível no provider
- `invalid_api_key` — Chave inválida

**Ação:** Falhar imediatamente, logar erro, notificar usuário via sistema de jobs.

### 🟡 Transient (Retry com Backoff)
Erros temporários que podem se resolver sozinhos:

- `429 Too Many Requests` — Rate limit atingido
- `5xx Server Error` — Falha temporária no provider
- `timeout` — Conexão ou resposta lenta
- `connection_error` — Falha de rede momentânea
- `service_unavailable` — Provider temporariamente fora

**Ação:** Retry com exponential backoff (max 3 tentativas). Janelas: 1s → 4s → 16s.

### 🔵 OOM (Out of Memory — Trocar Provider)
Erros que indicam que o modelo ficou sem recursos de GPU/memória:

- `CUDA out of memory`
- `GPU memory exhaustion`
- `model too large`
- `out of memory`

**Ação:** Não tentar o mesmo provider. Acionar chain fallback para próximo provider configurado.

## Chain Fallback

Quando um erro aciona fallback, o `AIOrchestrator` consulta o `AIFlowChain` do perfil ativo para o próximo modelo:

```
Anthropic Claude (OOM) →
  OpenAI GPT-4o (Transient, retry 3x) →
    Google Gemini 1.5 Pro (OK) → Return
```

**Configuração:** definida no AI Flow Studio por usage_type.

## Logging de Erros

Cada classificação é logada no `ConsoleLogger` com:
- `error_class`: permanent | transient | oom
- `provider`: anthropic | openai | google
- `model`: nome do modelo
- `attempt`: número da tentativa
- `action`: retry | fallback | fail

## Integração com Retry Node

O utility node `retry` usa o `ErrorClassifier` para decidir a estratégia:

```python
classification = error_classifier.classify(exception)
if classification == "permanent":
    raise  # Sem retry
elif classification == "oom":
    trigger_chain_fallback()
elif classification == "transient":
    exponential_backoff_retry(max_attempts=3)
```
"""
    },
    {
        "slug": "rate-limiting",
        "title": "Rate Limiting e Throttling por Modelo",
        "order_index": 27,
        "content": """# Rate Limiting e Throttling por Modelo

## Visão Geral

O sistema aplica rate limiting por modelo usando o algoritmo Sliding Window com Redis Sorted Sets. Cada modelo de IA pode ter limites independentes de requisições por janela de tempo.

**Implementação:** `backend/app/services/rate_limiter.py`

## Algoritmo: Sliding Window com Redis

```
Janela deslizante de N segundos:
1. Remover timestamps antigos (fora da janela)
2. Contar requests ativos (dentro da janela)
3. Se count >= limit: rejeitar (HTTP 429)
4. Senão: adicionar timestamp, executar
```

**Estrutura Redis:** `ZSET rate_limit:{model_id}` com score = timestamp Unix.

### Vantagem vs Fixed Window
A sliding window evita o "thundering herd" no início de cada janela fixa — distribuição mais uniforme de carga.

## Configuração por Modelo

Cada modelo (`ai_models` table) pode ter rate limit configurado:

```json
{
  "rate_limit": {
    "requests": 60,
    "window_seconds": 60
  }
}
```

| Provider | Modelo | Limite Padrão |
|----------|--------|---------------|
| Anthropic | Claude Sonnet 4.5 | 60 req/min |
| Anthropic | Claude Opus 4.5 | 20 req/min |
| Anthropic | Claude Haiku 4 | 100 req/min |
| OpenAI | GPT-4o | 60 req/min |
| Google | Gemini 1.5 Pro | 60 req/min |

## Integração com AI Flow

O utility node `rate_limiter` executa PRE-request:

```
Request → rate_limiter.check(model_id) →
  ALLOW: proceed to API call
  DENY: raise RateLimitExceeded →
    trigger retry node (espera window_reset_in segundos) OR
    trigger chain fallback para próximo modelo
```

## Headers de Resposta

Quando rate limit é atingido, o sistema inclui nos headers:
- `X-RateLimit-Limit`: limite configurado
- `X-RateLimit-Remaining`: requests restantes na janela
- `X-RateLimit-Reset`: timestamp Unix de reset da janela
- `Retry-After`: segundos para aguardar

## Fallback Automático

Se o modelo primário atinge rate limit e está configurado chain fallback, o sistema automaticamente tenta o próximo modelo na cadeia sem retornar erro para o usuário. O comportamento é transparente exceto pela latência adicional.
"""
    },
    {
        "slug": "pipeline-profiles",
        "title": "Pipeline Profiles e Fases Configuráveis",
        "order_index": 28,
        "content": """# Pipeline Profiles e Fases Configuráveis

## Visão Geral

Pipeline Profiles permitem configurar exatamente como cada fase do Deep Pipeline executa: qual modelo usar, quantos tokens alocar, nível de concorrência, e qual contrato de governança aplicar.

**Modelos:** `PipelineProfile`, `PipelineRun` (banco de dados)
**Implementação:** `backend/app/services/deep_pipeline.py`

## Estrutura de um Profile

```json
{
  "name": "production",
  "description": "Perfil padrão para análise de produção",
  "phases": {
    "phase_1": {
      "model": "claude-haiku-4",
      "max_tokens": 2000,
      "concurrency": 10,
      "contract": "deep_pipeline/phase1_file_analysis"
    },
    "phase_2": {
      "model": "claude-sonnet-4-5",
      "max_tokens": 4000,
      "concurrency": 3,
      "contract": "deep_pipeline/phase2_rule_synthesis"
    },
    "phase_3": {
      "model": "claude-sonnet-4-5",
      "max_tokens": 8000,
      "concurrency": 1,
      "contract": "deep_pipeline/phase3_arch_map"
    },
    "phase_4": {
      "model": "claude-sonnet-4-5",
      "max_tokens": 4000,
      "concurrency": 3,
      "contract": "deep_pipeline/phase4_cards"
    }
  },
  "quality_threshold": 70,
  "gap_fill_enabled": true
}
```

## Profiles Predefinidos

| Profile | Uso | Velocidade | Custo | Qualidade |
|---------|-----|-----------|-------|-----------|
| `quick` | Análise rápida / preview | ★★★★★ | ★ | ★★★ |
| `normal` | Uso padrão | ★★★ | ★★★ | ★★★★ |
| `deep` | Análise completa | ★ | ★★★★★ | ★★★★★ |
| `local` | Modelos locais (Ollama) | ★★ | ★★★★★ | ★★★ |

## Pipeline Run History

Cada execução do Deep Pipeline cria um registro `PipelineRun` com:

- **Fase a fase:** score de qualidade, duração, tokens usados, custo
- **Métricas agregadas:** score total, custo total, tempo total
- **Checkpoint state:** permite retomar após crash (resume from phase N)
- **Status:** pending → running → completed | failed

### Análise de Tendências

Com o histórico de execuções, o sistema pode mostrar:
- Melhoria de qualidade entre execuções
- Custo por projeto ao longo do tempo
- Fases com maior variação de performance

## Quality Threshold e Gap Filling (Phase 7)

Se `quality_threshold` está configurado (padrão: 70), após todas as fases:
1. Avaliar score de cada fase
2. Fases com score < threshold entram em **Gap Filling** (Phase 7)
3. Gap Filling re-executa apenas as fases problemáticas com modelo mais capaz
4. Máximo de 2 iterações de gap filling para evitar loops

## Configuração via Frontend

Pipeline profiles são gerenciáveis via AI Flow Studio (`/ai-flow`). O perfil ativo é selecionado antes de iniciar uma análise de projeto.
"""
    },
    {
        "slug": "modification-manager",
        "title": "Modification Manager e Task Blocking",
        "order_index": 29,
        "content": """# Modification Manager e Task Blocking

## Visão Geral

O Modification Manager detecta quando uma tarefa gerada por IA é semanticamente similar (>90%) a uma tarefa existente e propõe uma modificação em vez de duplicação. O fluxo protege contra duplicações acidentais e mantém o backlog limpo.

**Implementação:** `backend/app/services/modification_manager.py`

## Fluxo de Detecção

```
Nova task gerada →
  Calcular embedding (Nomic 768D) →
  Buscar tasks similares (cosine similarity) →
  Similarity >= 0.90? →
    SIM: Criar "modification proposal" →
         Bloquear task original (status = BLOCKED) →
         Notificar usuário via WebSocket
    NÃO: Inserir task normalmente
```

## Status BLOCKED no Kanban

Tasks bloqueadas aparecem na coluna especial **"Bloqueados"** do Kanban board com indicadores visuais:

- 🔴 Badge vermelho "Bloqueada"
- Tooltip com motivo do bloqueio
- Botões de ação: Aprovar Modificação | Rejeitar

## Fluxo de Aprovação

### Usuário Aprova
1. Task original arquivada (status = `archived`)
2. Nova task (modificação) inserida no backlog
3. Vínculos da task original migrados para nova (parent_id, labels, etc.)
4. Notificação de conclusão

### Usuário Rejeita
1. Task original desbloqueada (volta para status anterior)
2. Proposta de modificação descartada
3. Nova task não é criada
4. Log de rejeição para aprendizado futuro

## Threshold de Similaridade

O limite de 90% (0.90) foi calibrado para:
- Detectar duplicações semânticas óbvias
- Não bloquear tasks conceitualmente relacionadas mas distintas
- Balancear false positives vs false negatives

O threshold é configurável via contratos: `business/modification_thresholds.yaml`

## Campos de Rastreamento

Cada task pode ter em `generation_context`:

```json
{
  "blocked_by": "uuid-da-task-original",
  "block_reason": "Similarity 0.94 com task existente",
  "modification_proposal_id": "uuid-da-proposta",
  "similarity_score": 0.94
}
```

## Integração com REGRA #0

Se a task original foi editada manualmente pelo usuário, o Modification Manager **não bloqueia automaticamente**. Neste caso, apresenta apenas um aviso de similaridade e deixa o usuário decidir.
"""
    },
    {
        "slug": "continuous-rag",
        "title": "RAG Contínuo (Evolução em Tempo Real)",
        "order_index": 30,
        "content": """# RAG Contínuo (Evolução em Tempo Real)

## Visão Geral

O serviço de RAG Contínuo (`PROMPT #218`) mantém o conhecimento do projeto atualizado em tempo real. Detecta mudanças em arquivos do código-fonte usando hashing SHA-256 e re-processa automaticamente arquivos modificados.

**Implementação:** `backend/app/services/continuous_rag_service.py`

## Mecanismo de Detecção de Mudanças

```
Background job (interval: 5 min) →
  Scan arquivos do projeto →
  Para cada arquivo:
    SHA256(conteúdo atual) vs SHA256(versão indexada) →
    DIFERENTE: marcar para re-processamento →
    IGUAL: skip
  Processar fila de mudanças →
  Atualizar embeddings no RAG
```

**Redis:** Hashes são armazenados em `project_file_hashes:{project_id}` (Redis Hash).

## Tipos de Mudanças Detectadas

| Evento | Ação |
|--------|------|
| Arquivo novo | Indexar como `code_file` ou `document` |
| Arquivo modificado | Re-processar chunks afetados, atualizar embeddings |
| Arquivo deletado | Remover chunks do RAG, marcar como `archived` |
| Novo arquivo de config | Extrair novas configurações como business rules |

## Extração Contínua de Regras

Além de atualizar chunks de código, o RAG Contínuo também:
1. Analisa arquivos Python com IA (Claude Haiku) para extrair novas regras de negócio
2. Detecta alterações em contratos YAML e atualiza `business_rule` docs correspondentes
3. Monitora mudanças em prompts YAML para manter RAG de prompts atualizado

## Configuração

```json
{
  "continuous_rag": {
    "enabled": true,
    "interval_minutes": 5,
    "scan_extensions": [".py", ".ts", ".tsx", ".yaml", ".md"],
    "max_files_per_run": 50,
    "extract_rules": true,
    "rule_extraction_model": "claude-haiku-4"
  }
}
```

## Job Integration

O serviço é executado como job de background via o sistema de jobs (`PriorityJobExecutor`):
- **Prioridade:** P2 (normal)
- **Tipo:** `continuous_rag_scan`
- **Deduplicação:** Job não é agendado se já houver um em execução para o mesmo projeto

## Estado de Indexação por Arquivo

Cada arquivo indexado no RAG tem estado rastreado:
- `pending` → aguardando processamento
- `indexed` → processado com sucesso
- `failed` → falha no processamento (retentado na próxima execução)
- `archived` → arquivo removido do projeto

Consultar em: `rag_documents.metadata->>'file_state'`
"""
    },
    {
        "slug": "knowledge-graph",
        "title": "Knowledge Graph Builder",
        "order_index": 31,
        "content": """# Knowledge Graph Builder

## Visão Geral

O Knowledge Graph Builder constrói um grafo de dependências em memória a partir dos símbolos extraídos do código-fonte do projeto. É puramente estático — zero chamadas de IA — e alimenta a fase 3 do Deep Pipeline com análise de relacionamentos.

**Implementação:** `backend/app/services/knowledge_graph_builder.py`

## O que é Extraído

### Nós (Nodes)
Cada símbolo identificado no código:
- Classes, funções, interfaces, tipos
- Arquivo e linha de origem
- Métricas: LOC (lines of code), número de métodos, complexidade estimada

### Arestas (Edges)
Relacionamentos entre símbolos:
- `imports` — módulo A importa módulo B
- `calls` — função A chama função B
- `extends` — classe A herda de classe B
- `implements` — classe A implementa interface B

## Análises Geradas

### God Object Detection
Classes com indicadores de responsabilidade excessiva:
- LOC > 500 linhas
- Mais de 20 métodos
- Alta conectividade (muitos imports de outras classes)

**Ação:** Reportadas como candidatas a refatoração na fase de análise.

### Hub Analysis
Top 10 nós mais conectados (in-degree + out-degree):
- Identifica componentes críticos e pontos únicos de falha
- Auxilia na priorização de testes e documentação

### Layer Detection
Detecta a camada arquitetural de cada módulo:
- `route` — routers e controllers
- `service` — lógica de negócio
- `model` — entidades de dados
- `repository` — acesso a dados
- `utility` — helpers e utils

### Anti-Pattern Recognition
Padrões problemáticos detectados:
- Dependências circulares entre módulos
- Acesso direto a banco em routers (violação de camadas)
- Services que importam outros services diretamente (acoplamento)

## Formato de Saída

```json
{
  "nodes": 432,
  "edges": 1847,
  "god_objects": ["BacklogGenerator", "AIOrchestrator"],
  "hubs": ["ai_orchestrator", "rag_service", "backlog_generator"],
  "layers": {"route": 43, "service": 87, "model": 32, "utility": 65},
  "circular_deps": [],
  "layer_violations": ["router/backlog.py → db directly"]
}
```

## Integração com Deep Pipeline

O resultado do Knowledge Graph é armazenado em `project.context_semantic["knowledge_graph"]` e usado pela fase 4 (geração de cards) para:
- Identificar epics por módulo de alta complexidade
- Priorizar stories em god objects e hubs
- Gerar tasks de refatoração para anti-patterns detectados
"""
    },
    {
        "slug": "contracts-system",
        "title": "Sistema de Contratos (Governança)",
        "order_index": 32,
        "content": """# Sistema de Contratos (Governança)

## Visão Geral

O Sistema de Contratos define regras de governança estruturadas em YAML que controlam o comportamento do sistema: orçamentos de tokens, estados de workflow, critérios de qualidade e regras de fila. Contratos são versionados, auditáveis e editáveis via interface web.

**Implementação:** `backend/app/routers/contracts.py`, `ContractLoader`
**Frontend:** `/contracts`

## Domínios de Contratos

### `business/`
Regras de negócio e processo:
- `workflow_states.yaml` — Transições de status por tipo de card (Epic, Story, Task, Bug)
- `modification_thresholds.yaml` — Limites de similaridade para blocking
- `queue_scoring.yaml` — Fórmula de priorização da fila de prompts
- `validation_rules.yaml` — Regras de validação de cards

### `execution/`
Controles de execução de IA:
- `token_budgets.yaml` — Orçamentos por story points e item type
- `model_selection.yaml` — Critérios de seleção de modelo por complexidade
- `retry_policies.yaml` — Políticas de retry por tipo de erro
- `quality_thresholds.yaml` — Limites mínimos de qualidade por fase

### `generation/`
Parâmetros de geração de backlog:
- `hierarchy_rules.yaml` — Regras Epic→Story→Task (quantidade, proporções)
- `story_points.yaml` — Escala Fibonacci e critérios de atribuição
- `description_templates.yaml` — Templates de descrição por tipo

## Formato de um Contrato YAML

```yaml
name: token_budgets
domain: execution
version: "1.2"
description: Orçamentos de tokens por story points e tipo de item
effective_date: "2025-01-01"

rules:
  by_story_points:
    "1-3": 2000
    "5":   3000
    "8":   4000
    "13":  5000
    "21":  6000

  by_item_type:
    task: 2500
    bug:  2000
    story: 4000
    epic:  6000

  strategy: "MAX(sp_budget, type_budget)"
  default: 2500
  overage_action: "system_comment"

governance:
  requires_approval: false
  audit_on_change: true
  notify_on_breach: true
```

## ContractLoader

O `ContractLoader` busca contratos na seguinte ordem de prioridade:
1. **Banco de dados** (`contracts` table) — versão customizada por projeto
2. **Arquivo YAML** (`backend/contracts/`) — versão padrão do sistema
3. **Default hardcoded** — fallback se nenhum encontrado

Isso permite que cada projeto sobrescreva apenas os contratos que precisam customizar.

## Integração com AI Flow

Contratos também aparecem como **Visual Nodes** no AI Flow Studio. Um contrato pode ser arrastado para o pipeline para aplicar suas regras a uma etapa específica do fluxo. Exemplo: aplicar `token_budgets` no node de task execution.

## CRUD via Interface

Acesse `/contracts` para:
- Visualizar todos os contratos ativos
- Editar valores via editor YAML in-browser
- Criar versões customizadas por projeto
- Ver histórico de mudanças
- Comparar com versão padrão do sistema
"""
    },
    {
        "slug": "budget-manager",
        "title": "Budget Manager e Token Budgets",
        "order_index": 33,
        "content": """# Budget Manager e Token Budgets

## Visão Geral

O Budget Manager calcula e controla o orçamento de tokens para cada execução de task. Carrega os limites do contrato `execution/token_budgets.yaml` e detecta quando uma task está prestes a ultrapassar seu orçamento.

**Implementação:** `backend/app/services/budget_manager.py`

## Cálculo do Orçamento

O orçamento usa a estratégia **MAX(sp_budget, type_budget)**:

### Por Story Points (Fibonacci)
| Story Points | Budget |
|-------------|--------|
| 1-3 | 2.000 tokens |
| 5 | 3.000 tokens |
| 8 | 4.000 tokens |
| 13 | 5.000 tokens |
| 21 | 6.000 tokens |

### Por Tipo de Item
| Tipo | Budget |
|------|--------|
| Task | 2.500 tokens |
| Bug | 2.000 tokens |
| Story | 4.000 tokens |
| Epic | 6.000 tokens |

### Fórmula
```python
sp_budget = STORY_POINT_BUDGETS.get(story_points, 2500)
type_budget = ITEM_TYPE_BUDGETS.get(item_type, 2500)
final_budget = max(sp_budget, type_budget)
```

**Exemplo:** Task com SP=8 → max(4000, 2500) = **4.000 tokens**

## Ação em Caso de Overage

Se o contexto montado para execução ultrapassa o budget:
1. **Sistema adiciona comentário** na task com aviso de overage
2. **Recomendações automáticas:** reduzir contexto, quebrar em subtasks
3. **Execução prossegue** com contexto truncado (não bloqueia)
4. **Log de overage** para análise de tendências em `/analytics/tokens`

```python
# Exemplo de comentário gerado
{
  "type": "system_comment",
  "content": "⚠️ Orçamento de tokens excedido: 4.823/4.000 (20.6% overage).\n
  Recomendação: Considere quebrar esta task em 2 subtasks menores."
}
```

## Métricas de Budget

O Budget Manager expõe métricas visíveis no painel de analytics:
- **Budget utilization rate** por projeto (% do budget usado na média)
- **Overage frequency** — quantas tasks excedem o budget
- **Budget by domain** — distribuição de consumo por domínio

## Configuração

Editável via Sistema de Contratos (`/contracts`):
- `execution/token_budgets.yaml` — valores dos budgets
- `execution/quality_thresholds.yaml` — limites mínimos de qualidade associados

Alterações no contrato são aplicadas imediatamente (sem restart necessário) via `ContractLoader`.
"""
    },
    {
        "slug": "console-logger",
        "title": "Console Logger e Telemetria em Tempo Real",
        "order_index": 34,
        "content": """# Console Logger e Telemetria em Tempo Real

## Visão Geral

O Console Logger é um serviço central de logging estruturado que transmite eventos do sistema em tempo real via WebSocket. Permite observabilidade end-to-end de todas as operações de IA, RAG, cache e jobs sem precisar olhar logs do servidor.

**Implementação:** `backend/app/services/console_logger.py` (`PROMPT #168`)
**Frontend:** `/console`

## Categorias de Eventos

| Categoria | Exemplos |
|-----------|---------|
| `ai_call` | Prompt enviado, resposta recebida, tokens usados |
| `cache` | Cache HIT (exact/semantic/template), MISS, storage |
| `rag` | Query, resultados, similarity scores, chunks usados |
| `specs` | Spec carregada, tokens economizados |
| `job` | Job iniciado, progresso %, completado, falhou |
| `pipeline` | Fase iniciada, score de qualidade, tempo de fase |
| `performance` | Latência de API, tempo de embedding, throughput |
| `error` | Classificação, retry attempt, fallback acionado |

## Formato de Log

```json
{
  "timestamp": "2026-03-05T10:23:45.123Z",
  "level": "info",
  "category": "cache",
  "event": "cache_hit",
  "data": {
    "type": "semantic",
    "similarity": 0.97,
    "model": "claude-sonnet-4-5",
    "tokens_saved": 2847,
    "cost_saved_usd": 0.042
  },
  "project_id": "7cc16429...",
  "session_id": "abc123"
}
```

## Transmissão em Tempo Real

Logs são transmitidos via WebSocket para clientes conectados:

```
Backend → Redis Pub/Sub → WebSocket Server → Frontend /console
```

**Filtros disponíveis no frontend:**
- Por categoria (ai_call, cache, rag, etc.)
- Por nível (debug, info, warning, error)
- Por projeto
- Por session_id (para rastrear uma execução específica)
- Busca por texto

## Métricas de Performance (PROMPT #296)

O Console Logger também agrega métricas de performance em tempo real:
- **Tokens per second** — throughput atual de geração
- **P50/P95/P99 latência** de chamadas de IA por modelo
- **Cache hit rate** por tipo (L1/L2/L3)
- **RAG query time** — tempo médio de busca semântica
- **Cost per request** — custo em USD por operação

## Pipeline Telemetria (PROMPT #237)

Durante execução do Deep Pipeline, o Console Logger transmite:
- Progresso fase a fase (Phase 1/7: 23%)
- Score de qualidade de cada fase em tempo real
- Custo acumulado durante execução
- Arquivos processados vs total

## Retenção de Logs

- **Logs em tempo real:** descartados após sessão WebSocket fechada
- **Métricas agregadas:** armazenadas em `analytics_data` (30 dias)
- **Eventos críticos (error, overage):** persistidos em banco por 90 dias
"""
    },
]

def main():
    import os
    conn = psycopg2.connect(DB)
    cur = conn.cursor()

    # Check existing slugs
    cur.execute("""
        SELECT slug FROM wiki_pages WHERE project_id = %s
    """, (PROJECT_ID,))
    existing_slugs = {r[0] for r in cur.fetchall()}
    print(f"Existing wiki slugs: {len(existing_slugs)}")

    created = 0
    for page in NEW_WIKI_PAGES:
        slug = page["slug"]

        if slug in existing_slugs:
            print(f"  SKIP (exists): {slug}")
            continue

        page_id = make_wiki_id(slug)
        title = page["title"]
        order_index = page["order_index"]
        raw_content = page["content"]

        # Build file content with YAML front matter
        file_content = f"""---
title: "{title}"
slug: "{slug}"
source: "generated"
order_index: {order_index}
created_at: "{NOW}"
updated_at: "{NOW}"
---

{raw_content}
"""

        # Write to filesystem
        fs_path = os.path.join(WIKI_DIR, f"{slug}.md")
        os.makedirs(WIKI_DIR, exist_ok=True)
        with open(fs_path, "w", encoding="utf-8") as f:
            f.write(file_content)

        # Insert into wiki_pages table
        cur.execute("""
            INSERT INTO wiki_pages (id, project_id, title, slug, content, source, order_index, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, 'generated', %s, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        """, (page_id, PROJECT_ID, title, slug, raw_content, order_index))

        # Index in RAG
        rag_content = f"WIKI PAGE: {title}\nSlug: {slug}\n\n{raw_content}"
        embedding = get_embedding(rag_content)
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        metadata = json.dumps({
            "type": "wiki_page",
            "title": title,
            "slug": slug,
            "source": "generated",
            "order_index": order_index
        })

        rag_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO rag_documents (id, project_id, content, embedding, metadata, created_at)
            VALUES (%s, %s, %s, %s::vector, %s::jsonb, NOW())
        """, (rag_id, PROJECT_ID, rag_content, embedding_str, metadata))

        created += 1
        print(f"  CREATED: {slug} — {title}")

    conn.commit()
    print(f"\nTotal new wiki pages: {created}")

    # Verify
    cur.execute("SELECT COUNT(*) FROM wiki_pages WHERE project_id = %s", (PROJECT_ID,))
    print(f"Total wiki pages in DB: {cur.fetchone()[0]}")

    cur.execute("""
        SELECT COUNT(*) FROM rag_documents
        WHERE project_id = %s AND metadata->>'type' = 'wiki_page'
    """, (PROJECT_ID,))
    print(f"Total wiki RAG docs: {cur.fetchone()[0]}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    main()
