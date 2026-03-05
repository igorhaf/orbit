---
title: "Fluxos Principais do Sistema"
slug: "fluxos-principais"
source: "generated"
order_index: 24
created_at: "2026-03-05T04:46:26.299541"
updated_at: "2026-03-05T04:46:26.299541"
---

# Fluxos Principais do Sistema

## 1. Project Bootstrap Flow
```
POST /projects/create-and-process
  → Criar projeto no DB
  → Criar satellite directories
  → Detectar tech stack
  → Configurar git info
  → Iniciar scan inicial
  → [Opcional] Deep Pipeline (7 fases)
```

## 2. Interview to Backlog Flow
```
Usuário inicia entrevista
  → Phase 1: Fixed stack questions
  → Phase 2: Dynamic AI questions (Haiku)
  → Phase 3: Task-focused questions
  → Respostas armazenadas no RAG
  → BacklogGenerator: Epic → Story → Task
  → Cards aparecem no Kanban
```

## 3. AI Execution Flow
```
Service precisa de AI
  → PromptLoader carrega YAML
  → AIOrchestrator.execute()
    → CacheService check (L1 → L2 → L3)
    → Se cache HIT: retorna imediato (0 tokens!)
    → Se cache MISS:
      → Resolve model (usage_type → general → auto)
      → Rate limiter check
      → RAG context injection
      → Provider adapter (Anthropic/OpenAI/Google/Ollama)
      → Log usage (ai_usage_log)
      → Cache store
      → Return response
```

## 4. Deep Pipeline Flow
```
POST /rag/deep-pipeline
  → Phase 0: Structural scan (sem AI)
  → Phase 1: Per-file analysis (Haiku, 10x parallel)
  → Phase 2: Rule synthesis (Sonnet, 5x parallel)
  → Phase 3: Architectural map (Sonnet)
  → Phase 4: Card generation (Opus)
  → Phase 5: Wiki generation (Opus)
  → Phase 6: Quality scoring (0-100 per phase)
  → Phase 7: Gap filling (re-run phases < 70)
```

## 5. Continuous RAG Evolution
```
POST /rag/scan
  → Detectar arquivos novos/modificados
  → Indexar novos documentos
  → Extrair regras de negócio
  → Gerar/atualizar cards
  → Gerar/atualizar wiki
  → File states: pending → scanned → indexed → enriched
```

