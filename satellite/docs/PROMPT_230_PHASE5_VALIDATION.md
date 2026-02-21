# PROMPT #230 - Pipeline Incremental por Lotes (Fase 5)
## Validacao + Anti-Alucinacao

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation
**Impact:** Todos os outputs de IA validados contra contratos antes de persistir. Conteudo de baixa qualidade rejeitado automaticamente.

---

## Objective

Validar TODOS os outputs de IA contra contratos rigidos. Rejeitar conteudo de baixa qualidade ou alucinado antes de persistir no banco de dados.

**Key Requirements:**
1. Servico `pipeline_validator.py` com funcoes de validacao por tipo de output
2. Contrato `validation_rules.yaml` documentando as regras de qualidade
3. Integracao dos validators nos 3 servicos de pipeline (context, wiki, cards)
4. Coluna `batch_source` em Task e WikiPage para rastreabilidade
5. Epics com codigo rejeitados, Stories sem formato user story sinalizadas
6. Wiki sem secoes obrigatorias rejeitada

---

## What Was Implemented

### 1. Servico pipeline_validator.py
- `validate_context(current, updated, min_ratio=0.8)`: valida merge de contexto
  - Rejeita descricao curta (<50 chars)
  - Anti-shrink: rejeita se nova < 80% da atual
  - Alerta se sem marcadores de evidencia (descoberto em, origem:, fonte:)
- `validate_wiki_page(content, mode, existing_content, min_words)`: valida pagina wiki
  - Minimo de palavras (100 para create/merge)
  - Pelo menos 3/6 secoes obrigatorias (visao geral, regras, fluxos, entidades, restricoes, cenarios)
  - Anti-shrink para merge
  - Alerta se sem marcadores de evidencia
- `validate_card(title, description, item_type, acceptance_criteria)`: valida cards por nivel
  - Epic: detecta termos tecnicos (migration, endpoint, api, controller, etc.), rejeita se >2
  - Story: verifica formato user story (Como X, quero Y, para Z)
  - Alerta para missing acceptance criteria
- `validate_stories_response(ai_response)`: valida estrutura JSON de resposta AI
  - Verifica JSON valido
  - Campo stories como lista
  - Cada story com title e description

### 2. Contrato validation_rules.yaml
- Documentacao estruturada de todas as regras de validacao
- Separacao por severidade: blocking (rejeita) vs warning (log apenas)
- Regras para context_merge, wiki_page, card_epic, card_story, stories_response

### 3. Integracao nos Servicos Pipeline
- **pipeline_context.py**: Substituiu validacao inline por `validate_context()`. Rejeita merge que falha validacao.
- **pipeline_wiki.py**: Adicionou `validate_wiki_page()` em create e merge. Rejeita paginas sem secoes obrigatorias.
- **pipeline_cards.py**: Adicionou `validate_card()` para Epics e Stories, `validate_stories_response()` para respostas AI. Logs de warning para issues nao-bloqueantes.

### 4. Coluna batch_source (JSONB)
- **Task**: `batch_source` armazena `{batch_label, domain, type}` para epics e `{batch_label, domain, source_file}` para stories
- **WikiPage**: `batch_source` armazena `{domain, rules_added, action}` para paginas criadas
- Migration `20260218_add_batch_source.py` aplicada com sucesso

---

## Files Modified/Created

### Created:
1. **backend/app/services/pipeline_validator.py** - Servico de validacao (~257 linhas)
   - 4 funcoes de validacao
   - Constantes: WIKI_MANDATORY_SECTIONS, TECHNICAL_TERMS, USER_STORY_PATTERN
2. **backend/app/contracts/pipeline/validation_rules.yaml** - Contrato de regras de validacao
3. **backend/alembic/versions/20260218_add_batch_source.py** - Migration batch_source
4. **rag/internal/PROMPT_230_PHASE5_VALIDATION.md** - Este report

### Modified:
1. **backend/app/services/pipeline_context.py** - +10 linhas
   - Import de validate_context
   - Substituiu validacao inline por validate_context()
2. **backend/app/services/pipeline_wiki.py** - +20 linhas
   - Import de validate_wiki_page
   - Validacao em _create_domain_page e _merge_domain_page
   - batch_source no WikiPage criado
3. **backend/app/services/pipeline_cards.py** - +25 linhas
   - Import de validate_card, validate_stories_response
   - Validacao de Epic e Story
   - validate_stories_response substitui parsing manual de JSON
   - batch_source nos Tasks criados
4. **backend/app/models/task.py** - +4 linhas
   - Coluna batch_source (JSONB, nullable)
5. **backend/app/models/wiki_page.py** - +5 linhas
   - Import JSONB
   - Coluna batch_source (JSONB, nullable)

---

## Testing Results

### Verification:
```
OK  pipeline_validator imports
OK  pipeline_context imports (with validator)
OK  pipeline_wiki imports (with validator)
OK  pipeline_cards imports (with validator)
OK  Task model (with batch_source)
OK  WikiPage model (with batch_source)
OK  Migration applied successfully
OK  Backend restart: no errors
OK  All Python files syntax valid
OK  Validator tests:
    - Context rejects short descriptions
    - Wiki validates sections correctly
    - Epic detects technical terms (migration, endpoint, api)
    - Story validates user story format
    - Stories response validates JSON structure
```

---

## Success Metrics

- **Anti-hallucination**: Epics com termos tecnicos (migration, endpoint, api) rejeitados/sinalizados
- **Wiki quality**: Paginas sem secoes obrigatorias rejeitadas antes de persistir
- **Anti-shrink**: Context e Wiki merge que encolheriam conteudo rejeitados
- **Evidence tracking**: Alertas para conteudo sem marcadores de evidencia
- **Batch traceability**: batch_source em todos os entities novos (Task, WikiPage)
- **Zero breaking changes**: Backward compatible, colunas nullable

---

## Key Insights

### 1. Severidade Blocking vs Warning
Nem toda issue de validacao deve bloquear a persistencia. Evidencia ausente e formato user story sao warnings (logados), enquanto shrinkage e secoes faltantes sao blocking (rejeitam).

### 2. Validacao Centralizada
Ter um servico centralizado de validacao (pipeline_validator.py) permite:
- Reutilizacao entre servicos
- Facilidade de ajustar thresholds
- Testes unitarios independentes do pipeline

### 3. batch_source como JSONB
JSONB permite flexibilidade no conteudo do batch_source sem precisar de colunas adicionais. Cada tipo de entidade armazena dados diferentes (epic vs story vs wiki page).

---

## Status: COMPLETE

Fase 5 implementada e verificada. Todos os outputs de IA passam por validacao antes de persistir.

**Key Achievements:**
- pipeline_validator.py com 4 funcoes de validacao
- Contrato validation_rules.yaml documentando regras
- Integracao em pipeline_context, pipeline_wiki, pipeline_cards
- batch_source JSONB em Task e WikiPage
- Migration aplicada com sucesso

**Impact:**
- Epics com codigo tecnico sinalizados/rejeitados
- Stories sem formato user story alertadas
- Wiki sem secoes obrigatorias rejeitada
- Merge que encolheria conteudo bloqueado
- Rastreabilidade completa via batch_source

**Pipeline Completo (Fases 1-5):**
- Fase 1: Classificacao de arquivos por camada semantica
- Fase 2: Contexto incremental por lote
- Fase 3: Wiki padronizada com contratos rigidos
- Fase 4: Cards hierarquicos (Epic -> Story) por lote
- Fase 5: Validacao + Anti-alucinacao (esta fase)
