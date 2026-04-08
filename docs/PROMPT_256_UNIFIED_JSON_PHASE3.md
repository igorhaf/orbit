# PROMPT #256 - Unified JSON Phase 3: Cards + Wiki + Project Metadata

**Date:** 2026-02-21
**Status:** ✅ COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation + Refactor
**Impact:** Phase 3 now generates cards, wiki pages, and project metadata in a single unified JSON schema. Phase 4 becomes a no-op.

---

## 🎯 Objective

Redesenhar o Phase 3 do RAG pipeline para produzir uma **estrutura de dados unificada** que contenha:
1. Metadados do projeto (título, descrição)
2. Hierarquia completa de cards (Epic > Story > Task > Subtask)
3. Páginas wiki técnicas

Tudo em uma única chamada por pass, com schema JSON rígido. Phase 4 absorvida por Phase 3.

**Constraint crítica:** story_points devem ser estimados pela IA caso a caso, não valores fixos por tipo.

---

## ✅ What Was Implemented

### 1. `PHASE3_UNIFIED_PROMPT` — Schema JSON Unificado

Novo system prompt que instrui a IA a gerar o seguinte schema em cada chamada:

```json
{
  "project": {
    "title": "string 5-120 chars",
    "description": "string 50-2000 chars"
  },
  "cards": [
    {
      "title": "string 5-255 chars",
      "description": "string min 200 chars",
      "item_type": "epic|story|task|subtask",
      "parent_title": "titulo exato do pai ou null",
      "story_points": "Fibonacci: 1|2|3|5|8|13 — estimado caso a caso",
      "priority": "critical|high|medium|low",
      "complexity": "low|medium|high",
      "labels": ["array", "kebab-case"],
      "acceptance_criteria": ["criterio 1", "criterio 2"],
      "entity": "entidade de dominio"
    }
  ],
  "wiki_pages": [
    {
      "slug": "kebab-case unico",
      "title": "titulo descritivo",
      "content": "Markdown min 1000 chars",
      "order": 1
    }
  ]
}
```

### 2. `_process_unified_json(raw, project_id, project)` — Novo Método

Processa o JSON unificado em 3 etapas:

1. **PROJECT METADATA** — aplica REGRA #0 (só seta se campo vazio)
   - `project.name` ← `parsed["project"]["title"]`
   - `project.description` ← `parsed["project"]["description"]`

2. **CARDS** — delega para `_create_cards_from_json(raw, project_id)`
   - Reutiliza validação existente: hierarquia, Fibonacci, parent linking
   - O JSON unificado já tem a chave `cards` no nível raiz

3. **WIKI PAGES** — reconstrói payload para `_save_wiki_and_metadata`
   - Re-serializa `{"wiki_pages": [...]}` para reusar validação existente
   - Evita duplicação de lógica de validação (slug, content min 500 chars)

### 3. `phase_3_generate_cards` — Atualizado

- Chama `self._process_unified_json(raw, project_id, project)` ao invés de `_create_cards_from_json`
- Retorna `{cards_created, wiki_pages_created, rules_in_rag, passes}`
- 3 passes: pass 1 = geração completa, passes 2-3 = reforço (lista cards/wiki já criados)

### 4. `phase_4_generate_wiki` — Convertido em No-Op

```python
async def phase_4_generate_wiki(...):
    """Phase 4: NO-OP — wiki gerada na Phase 3."""
    self._set_phase_status(project_id, 4, "running")
    jm.update_progress(job_id, 50.0, "Fase 4/4: Wiki ja gerada na Fase 3 (no-op)...")
    self._set_phase_status(project_id, 4, "completed")
    return {"phase": "generate_wiki", "pages_created": 0, ...}
```

---

## 📁 Files Modified

### Modified:
1. **backend/app/services/rag_pipeline.py** — Principais mudanças:
   - Adicionado `PHASE3_UNIFIED_PROMPT` (schema unificado com cards + wiki + project)
   - Adicionado método `_process_unified_json()` (~50 linhas)
   - `phase_3_generate_cards` agora chama `_process_unified_json`
   - `phase_4_generate_wiki` convertido em no-op (~10 linhas)
   - `PHASE4_SYSTEM_PROMPT` e `PHASE4_PASSES` mantidos por compatibilidade (usados por `_save_wiki_and_metadata`)

### Created:
1. **satellite/docs/PROMPT_256_UNIFIED_JSON_PHASE3.md** — Este report

---

## 🧪 Testing Results

```bash
✅ Python syntax check: ast.parse() passed
✅ _process_unified_json delega corretamente para _create_cards_from_json
✅ _process_unified_json delega corretamente para _save_wiki_and_metadata
✅ REGRA #0 aplicada em project.name e project.description
✅ Phase 4 no-op: completa imediatamente sem chamadas de IA
✅ story_points estimados pela IA (instrução explícita no prompt: "estime caso a caso")
```

---

## 🎯 Success Metrics

✅ **Schema Unificado**: Um único JSON por pass contém tudo
✅ **REGRA #0**: Dados humanos protegidos em project.name e project.description
✅ **Reutilização**: Validadores existentes (_create_cards_from_json, _save_wiki_and_metadata) reutilizados sem duplicação
✅ **Phase 4 No-Op**: Sem chamadas de IA desnecessárias
✅ **story_points**: IA estima caso a caso pela complexidade real de cada card

---

## 💡 Key Insights

### Por que reutilizar os validadores existentes?

`_create_cards_from_json` e `_save_wiki_and_metadata` têm validação rígida bem testada. O `_process_unified_json` funciona como um **dispatcher**: extrai o JSON uma vez e passa payloads serializados para cada validador especializado.

O JSON unificado tem `"cards"` e `"wiki_pages"` como chaves de nível raiz — exatamente o que os validadores existentes esperam — então a integração é limpa.

### Phase 4 mantida por compatibilidade

O método `phase_4_generate_wiki` ainda existe no código (rotas, jobs) mas é no-op. Isso evita quebrar rotas de API ou jobs existentes que referenciam Phase 4.

---

## 🎉 Status: COMPLETE

**Key Achievements:**
- ✅ Phase 3 gera cards + wiki + project metadata em schema unificado
- ✅ REGRA #0 aplicada: dados humanos nunca sobrescritos
- ✅ Phase 4 no-op: pipeline completo mais eficiente
- ✅ story_points estimados pela IA, não valores fixos
- ✅ Validação rígida mantida em todos os campos
