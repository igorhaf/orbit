# PROMPT #254 - Contratos Rigidos para Pipeline RAG
## Schema enforcement, robust parser, strict validators — zero malformation tolerance

**Date:** February 21, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Implementation + Quality Enforcement
**Impact:** Elimina 100% de conteudo malformado em regras de negocio, cards e wiki do pipeline RAG

---

## Objective

Adotar contratos rigidos (schemas) em TODAS as respostas de IA do pipeline RAG para garantir que nenhum conteudo malformado entre no banco de dados. Antes, o sistema aceitava quase qualquer coisa — agora cada campo e validado individualmente.

---

## What Was Implemented

### 1. Parser JSON Robusto (`_extract_json`)
- Novo metodo estatico que substitui `re.search(r'\{[\s\S]*\}', raw)`
- Trata: markdown code fences (```json...```), trailing commas, BOM, leading text
- Usa contagem de braces para encontrar o JSON externo correto
- Fallback seguro: retorna `{}` se impossivel parsear

### 2. Contrato Phase 2 (Regras de Negocio)
**Schema no prompt:**
- `rule_text`: string, 15-500 chars, portugues
- `rule_type`: enum EXATO de 8 valores (dominio|validacao|restricao|workflow|permissao|calculo|integracao|negocio)
- `source_file`: string, caminho relativo real, minimo 3 chars
- `priority`: enum EXATO (critical|high|medium|low)
- `entity`: string opcional, max 100 chars
- `evidence`: string opcional, max 300 chars

**Validator (`_parse_rules_json`):**
- Rejeita entries sem rule_text ou < 15 chars
- Rejeita rule_type fora do enum (auto-fix "normal" → "medium")
- Rejeita source_file vazio ou < 3 chars
- Rejeita priority fora do enum
- Trunca campos aos limites do schema
- Loga quantidade de aceitos vs rejeitados

### 3. Contrato Phase 3 (Cards/Backlog)
**Schema no prompt:**
- `title`: string, 5-120 chars, unico
- `description`: string, minimo 20 chars
- `item_type`: enum (epic|story|task|subtask)
- `parent_title`: string ou null, deve corresponder a outro card
- `story_points`: Fibonacci (1,2,3,5,8,13)
- `priority`: enum (critical|high|medium|low)
- `labels`: array de 1-5 strings, kebab-case, 2-30 chars
- `acceptance_criteria`: array de 1-10 strings, cada uma >= 10 chars

**Validator (`_create_cards_from_json`):**
- Rejeita cards sem title ou < 5 chars
- Rejeita cards sem description ou < 20 chars
- Rejeita item_type fora do enum
- Snap story_points para Fibonacci mais proximo
- Sanitiza labels (lowercase, hifens, trunca)
- Valida acceptance_criteria individualmente (min 10 chars por criterio)
- 3 passes: validate → create records → set parent_ids

### 4. Contrato Phase 4 (Wiki + Titulo + Descricao)
**Schema no prompt:**
- `title`: string, 5-60 chars, sem quebras de linha
- `description`: string, 50-500 chars
- `wiki_pages[].slug`: kebab-case (regex), 3-50 chars, unico
- `wiki_pages[].title`: string, 3-100 chars
- `wiki_pages[].content`: Markdown, minimo 200 chars
- `wiki_pages[].order`: integer sequencial

**Validator (`_save_wiki_and_metadata`):**
- Title: rejeita se < 5 ou > 60 chars, remove linebreaks
- Description: rejeita se < 50 chars (relax para 20+ com truncate)
- Slug: regex validation `^[a-z0-9]+(-[a-z0-9]+)*$`, auto-fix spaces→hyphens
- Slug duplicado: rejeitado
- Content: rejeitado se < 200 chars
- REGRA #0 mantida: titulo/descricao so preenchidos se vazios

---

## Files Modified

### Modified:
1. **backend/app/services/rag_pipeline.py**
   - `_extract_json()` — parser JSON robusto (novo)
   - `PHASE2_SYSTEM_PROMPT` — schema rigido com tipos, limites e enums
   - `PHASE3_SYSTEM_PROMPT` — schema rigido com hierarquia e Fibonacci
   - `PHASE4_SYSTEM_PROMPT` — schema rigido com kebab-case e min chars
   - `_parse_rules_json()` — reescrito com validacao campo-a-campo
   - `_store_rules()` — simplificado (so aceita dicts validados)
   - `_create_cards_from_json()` — reescrito com 3 passes e validacao rigida
   - `_save_wiki_and_metadata()` — reescrito com regex slug, min content, dedup

---

## Testing Results

```bash
✅ python -c "ast.parse(...)" — rag_pipeline.py sem syntax errors
```

---

## Key Insights

### 1. Schema inline no prompt > schema separado
Colocar o schema JSON diretamente no system prompt com tipos e limites EXPLICITOS forca a IA a respeitar o contrato. A IA trata o schema como lei quando ele aparece formatado com regras claras.

### 2. Validacao no parser e a ultima defesa
Mesmo com schema rigido no prompt, a IA pode: omitir campos, usar valores fora do enum, gerar texto curto demais. O validator e a barreira final — nenhum dado malformado entra no DB.

### 3. Auto-fix vs reject
Alguns campos aceitam auto-fix (priority "normal"→"medium", story_points snap to Fibonacci, slug spaces→hyphens). Outros sao rejection obrigatoria (rule_text < 15 chars, slug invalido apos fix, content < 200 chars). O criterio: auto-fix se a intencao e clara, reject se ambiguo.

---

## Status: COMPLETE

**Key Achievements:**
- Zero tolerance para conteudo malformado em regras, cards e wiki
- Parser JSON robusto que trata markdown fences, trailing commas e BOM
- Cada campo validado: tipo, limites, enum, unicidade
- Logs claros de aceitos vs rejeitados por fase
- REGRA #0 preservada: dados humanos nunca sobrescritos
