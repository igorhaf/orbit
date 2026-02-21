# PROMPT #230 - Pipeline Incremental por Lotes (Fase 4)
## Hierarquia Completa de Cards por Lote

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Cards hierarquicos (Epic -> Story) criados a cada lote, com classificacao stack-agnostic e gradiente de linguagem

---

## Objective

Cada lote gera cards hierarquicos (Epic -> Story) com gradiente de linguagem.
Classificacao stack-agnostic de dominio substitui a _classify_rule_domain hardcoded (Laravel-specific).
Cards sao ESTENDIDOS a cada lote (nunca recriados).

**Key Requirements:**
1. Novo servico `HierarchicalCardService` com extend_cards_from_batch
2. Contrato `card_hierarchy.yaml` para geracao de Stories via IA
3. Classificacao stack-agnostic de dominio (funciona com qualquer framework)
4. Gradiente de linguagem: Epic (funcional) -> Story (user story format)
5. Labels incluem batch number: `["auto-discovered", "batch-N"]`
6. Similarity check para nunca duplicar cards existentes
7. Executa a CADA lote com rules > 0 (sem guard `pending_remaining == 0`)

---

## What Was Implemented

### 1. Contrato pipeline/card_hierarchy.yaml
- Formato User Story: "Como [usuario], quero [acao], para [beneficio]"
- Maximo 5 stories por chamada
- 2-4 criterios de aceitacao por story
- Inclui regra original e arquivo fonte na descricao
- Retorno JSON estruturado

### 2. Servico HierarchicalCardService (pipeline_cards.py)
- `extend_cards_from_batch()`: orquestra criacao de cards por lote
- `_find_existing_domain_epic()`: busca Epic existente por labels e titulo
- `_create_domain_epic()`: cria Epic via IA (epic_from_rules.yaml) com gradiente funcional
- `_create_stories_for_domain()`: cria Stories via IA (card_hierarchy.yaml) como user stories
- `_fallback_stories()`: cria stories simples se IA falhar
- `_classify_domain()`: classificacao stack-agnostic (reutiliza logica de pipeline_wiki)
- `_filter_duplicates()`: similarity check com embeddings 384-dim (threshold 0.90)
- `_is_duplicate()`: verifica duplicacao individual
- Labels incluem batch_label: `["auto-discovered", "batch-N"]`

### 3. Integracao no batch_processing_cycle (watchdog.py)
- Step 3 reescrito: usa HierarchicalCardService em vez de _auto_discover_cards
- Executa a CADA lote com rules > 0 (removido guard `pending_remaining == 0`)
- Log inclui contagem de epics e stories criadas

---

## Files Modified/Created

### Created:
1. **backend/app/contracts/pipeline/card_hierarchy.yaml** - Contrato de geracao de stories
2. **backend/app/services/pipeline_cards.py** - HierarchicalCardService (~350 linhas)
3. **rag/internal/PROMPT_230_PHASE4_HIERARCHICAL_CARDS.md** - Este report

### Modified:
1. **backend/app/services/watchdog.py** - Step 3 reescrito para cards hierarquicos
2. **CLAUDE.md** - Atualizado prompt counter para Fase 4

---

## Testing Results

### Verificacao:
```
OK  HierarchicalCardService importa corretamente
OK  ContractLoader renderiza pipeline/card_hierarchy.yaml
OK  System prompt: 1065 chars (compacto para qwen3:8b)
OK  watchdog.py syntax valida
OK  pipeline_cards.py syntax valida
OK  orbit restart: todos servicos green
OK  Backend logs: sem erros apos restart
```

---

## Gradiente de Linguagem

| Nivel   | Linguagem      | Exemplo                                                     |
|---------|----------------|-------------------------------------------------------------|
| Epic    | 100% funcional | "O sistema permite que alunos se inscrevam em cursos"       |
| Story   | User story     | "Como aluno, quero ver meu progresso, para saber quanto falta" |
| Task    | Semi-tecnico   | (Fase futura: "Implementar endpoint GET /api/progress")     |
| Subtask | Tecnico        | (Fase futura: "Criar migration add_progress_to_enrollments")|

---

## Success Metrics

- **Cards por lote**: Criados a CADA lote (sem esperar pending=0)
- **Stack-agnostic**: Classificacao funciona com Laravel, Next.js, Django, Spring, Go
- **Sem duplicatas**: Similarity check com embeddings 384-dim
- **Gradiente**: Epics funcionais, Stories como user stories
- **Batch traceability**: Labels incluem "batch-N"
- **Zero breaking changes**: _auto_discover_cards e _classify_rule_domain mantidos no watchdog (usados pelo watchdog_cycle)

---

## Status: COMPLETE

Fase 4 implementada e verificada. Cards hierarquicos criados a cada lote.

**Key Achievements:**
- HierarchicalCardService com Epic -> Story hierarchy
- Contrato card_hierarchy.yaml para user stories via IA
- Classificacao stack-agnostic de dominio
- Similarity check para evitar duplicatas
- Batch labels para rastreabilidade

**Impact:**
- Cards aparecem durante o processamento (nao espera fim)
- Epics organizados por dominio de negocio (stack-agnostic)
- Stories no formato padrao "Como X, quero Y, para Z"
- Base para Fase 5: validacao anti-alucinacao
