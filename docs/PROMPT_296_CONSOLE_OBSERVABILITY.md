# PROMPT #296 - Console Observability (Fase 1)
## Principio Laboratorial - Rastreabilidade de Operacoes no Console

**Date:** 2026-02-16
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Console agora agrupa eventos por operacao, mede duracao por fase, mostra custos de IA, identifica gargalos e sugere otimizacoes

---

## Objetivo

Transformar a pagina Console (`/console`) no painel central de rastreabilidade - um "laboratorio" onde analistas de IA podem observar cada evento, diagnosticar problemas de performance e compor correcoes. Motivado pelo projeto MacGyver (42 arquivos PHP) que demonstrava lentidao no scan sem visibilidade sobre o que acontecia.

**Requisitos:**
1. Agrupar eventos por `trace_id` para correlacionar logs de uma mesma operacao
2. Medir duracao por fase do Memory Scan
3. Mostrar tokens, custo e modelo de IA no console
4. Gerar diagnosticos automaticos (gargalos, sugestoes de otimizacao)
5. Nova vista Timeline com cards de operacao colapsaveis

---

## O Que Foi Implementado

### 1. ConsoleLogEntry Estendido (backend)
- 7 novos campos: `trace_id`, `operation_name`, `phase_name`, `cost_usd`, `model_name`, `input_tokens`, `output_tokens`
- Nova categoria `PERFORMANCE` no enum `LogCategory`
- Todos os parametros propagados pelo metodo `log()`

### 2. Novos Metodos de Conveniencia (backend)
- `log_operation_start(trace_id, operation_name, phase_name, ...)` - Marca inicio de fase
- `log_operation_end(trace_id, operation_name, phase_name, duration_ms, tokens, cost, model, ...)` - Marca fim com metricas
- `log_operation_summary(trace_id, operation_name, total_duration, phases[], diagnostics[], ...)` - Resumo completo

### 3. Memory Scan Instrumentado (backend)
- `trace_id` gerado no inicio de cada scan
- 6 fases instrumentadas com START/END: Deteccao de Stack, Varredura de Arquivos, Indexacao RAG, Extracao de Amostras, Analise IA, Armazenamento de Regras
- Metricas de tokens e custo capturadas da fase de Analise IA
- Metodo `_generate_scan_diagnostics()` com 4 regras:
  - Fase com >50% do tempo = alerta de gargalo
  - Scan >60s = sugerir scan_depth='quick'
  - >50k tokens = sugerir modelo mais economico
  - Custo >$0.10 = sugerir Haiku

### 4. AIOrchestrator com trace_id (backend)
- Parametro `trace_id` adicionado ao `execute()`
- Propagado para `log_ai_prompt()` e `log_ai_response()`
- Calculo de custo via `pricing.calculate_cost()` no log de resposta

### 5. Endpoint GET /console/operations (backend)
- Agrupa logs do buffer por `trace_id`
- Retorna timeline de operacoes com fases, duracao, tokens, custo, gargalo e diagnosticos
- Filtro opcional por `project_id`

### 6. Toggle Terminal/Timeline no Console (frontend)
- Botoes "Terminal" | "Timeline" no header
- Estado `viewMode` controla qual vista renderizar
- Interface `LogEntry` estendida com campos de observabilidade

### 7. Componente TimelineView (frontend)
- Agrupa logs por `trace_id` em cards colapsaveis
- Header: nome da operacao + badge de duracao (Rapido/Moderado/Lento) + tokens + custo + modelos
- Conteudo expandido: OperationSummaryCard + lista de eventos raw
- Secao "Eventos Avulsos" para logs sem trace_id
- Polling a cada 10s no endpoint /operations para dados atualizados

### 8. Componente OperationSummaryCard (frontend)
- Barra de duracao empilhada colorida (proporcional por fase)
- Tabela de fases: Nome | Duracao | Tokens | Custo | Modelo
- Gargalo destacado em vermelho
- Diagnosticos e sugestoes em amarelo

---

## Arquivos Modificados/Criados

### Modificados:
1. **backend/app/services/console_logger.py** - Campos, metodos e categoria PERFORMANCE
2. **backend/app/services/codebase_memory.py** - Instrumentacao do scan com trace_id e timing
3. **backend/app/services/ai_orchestrator.py** - trace_id no execute() + calculo de custo
4. **backend/app/api/routes/console.py** - Endpoint GET /operations
5. **frontend/src/app/console/page.tsx** - Toggle view mode + LogEntry estendida

### Criados:
6. **frontend/src/components/console/TimelineView.tsx** - Vista de timeline agrupada
7. **frontend/src/components/console/OperationSummaryCard.tsx** - Card de resumo rico

---

## Verificacao

```bash
Backend: 4 arquivos modificados com novos campos, metodos e endpoint
Frontend: 1 arquivo modificado + 2 componentes novos
LogCategory.PERFORMANCE adicionada
3 novos metodos: log_operation_start, log_operation_end, log_operation_summary
6 fases do Memory Scan instrumentadas com timing
Diagnosticos automaticos com 4 regras de deteccao
Timeline view com cards colapsaveis e barra de duracao empilhada
```

---

## Metricas de Sucesso

- **7 campos** adicionados ao ConsoleLogEntry para observabilidade completa
- **3 metodos** novos de conveniencia para rastreamento de operacoes
- **6 fases** do Memory Scan instrumentadas individualmente
- **4 regras** de diagnostico automatico implementadas
- **2 vistas** no Console: Terminal (existente) e Timeline (nova)
- **1 endpoint** novo para consulta de operacoes agrupadas

---

## Insights

### 1. Abordagem Minimamente Invasiva
Todos os novos campos sao `Optional`, garantindo compatibilidade retroativa. Logs existentes sem `trace_id` continuam funcionando normalmente.

### 2. Ephemeral vs Persistent
Seguindo o padrao do PROMPT #217, os eventos de performance sao persistidos no buffer (diferente de streaming chunks que sao efemeros).

### 3. Diagnosticos Baseados em Metricas
As regras de diagnostico usam thresholds praticos derivados da observacao de scans reais: 50% do tempo em uma fase indica gargalo, >60s sugere modo quick, >50k tokens sugere modelo menor.

---

## Status: COMPLETE

**Entregas:**
- Console transformado em painel de observabilidade com agrupamento por operacao
- Memory Scan completamente instrumentado com timing, tokens e custo por fase
- Diagnosticos automaticos identificam gargalos e sugerem otimizacoes
- Vista Timeline rica com cards colapsaveis, barras de duracao e tabelas de metricas

**Impacto:**
- Visibilidade total sobre o que acontece durante scans lentos
- Identificacao automatica de fases problematicas
- Base para otimizacoes futuras guiadas por dados reais
