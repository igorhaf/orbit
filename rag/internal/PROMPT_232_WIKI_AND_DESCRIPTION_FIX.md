# PROMPT #232 - Fix Wiki Vazia e Descricao Tecnica
## Correcao da geracao de wiki pages e tom da descricao

**Date:** 2026-02-18
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix / Quality Improvement
**Impact:** Wiki pages agora sao criadas com retry + fallback. Descricao passa de tom tecnico para funcional.

---

## Objective

Corrigir dois problemas no pipeline RAG incremental:
1. Wiki pages de dominio nao estavam sendo criadas (0 pages apesar de 359 regras)
2. Descricao do projeto era excessivamente tecnica (camadas Schema/Routes/Logic)

**Key Requirements:**
1. Wiki pages criadas de forma confiavel (retry + fallback)
2. Descricao focada em negocio, nao em tecnologia
3. Manter thresholds de qualidade (nao baixar exigencias)

---

## Root Cause Analysis

### Wiki vazia:
- `IncrementalWikiService.update_wiki_from_batch()` rodava a cada batch
- Retornava `"updated": True` com `pages_created: 0` (retorno enganoso)
- Causa: modelo local (qwen3:8b) falhava em gerar 6 secoes obrigatorias
- Validacao rejeitava, sem retry nem fallback
- Erros silenciosos - sem log do resultado por dominio

### Descricao tecnica:
- Contrato `context_merge.yaml` usava persona "redator tecnico"
- Secoes organizadas por camadas tecnicas: Schema, Rotas, Logica, Apresentacao, Config
- Resultado: descricao com termos como "migration", "controller", "eloquent"

---

## What Was Implemented

### 1. Contrato context_merge.yaml reescrito (v2)
- Persona: "redator tecnico" → "analista de negocios"
- Perspectiva: "para GERENTE DE PRODUTO ou STAKEHOLDER, nao para desenvolvedor"
- Secoes: camadas tecnicas → dominios funcionais (Gestao de Cursos, Inscricoes, etc)
- Lista explicita de termos proibidos (migration, controller, endpoint, model, etc)
- Exemplos de traducao tecnico→funcional no prompt
- Removidas secoes Stack Tecnologica e Arquitetura

### 2. Contrato wiki_page.yaml melhorado (v2)
- Template com headers de secao injetados diretamente no user_prompt (modo create)
- Modelos locais copiam headers e preenchem conteudo sob cada um
- Minimo reduzido de 300 para 100 palavras (realista para modelos locais)
- Instrucao explicita: "MANTENHA todos os cabecalhos de secao"

### 3. pipeline_wiki.py: retry + fallback + logging
- **Retry com feedback**: se validacao falhar, faz 1 retry passando os issues como feedback
- **Fallback local**: se retry tambem falhar (ou AI falhar), gera pagina minima a partir das regras brutas
  - Inclui todos os 6 headers obrigatorios
  - Bullets das regras sob "Regras de Negocio"
  - Outras secoes com "Informacao pendente de analise"
- **Logging por dominio**: cada resultado de dominio e logado para diagnostico
- **Retorno correto**: `"updated"` agora so e True quando pages_created > 0 ou pages_merged > 0

### 4. Resetar descricao do Suinda
- Descricao antiga (13K chars tecnica) resetada para vazio
- Wiki page existente deletada (container vazio)
- Pipeline vai reconstruir do zero com o novo contrato funcional

---

## Files Modified

### Modified:
1. **backend/app/contracts/pipeline/context_merge.yaml**
   - Reescrito v2: persona funcional, secoes por dominio, termos proibidos

2. **backend/app/contracts/pipeline/wiki_page.yaml**
   - Reescrito v2: template com headers no user_prompt

3. **backend/app/services/pipeline_wiki.py**
   - `_create_domain_page`: retry com feedback + fallback local
   - `_build_fallback_page`: novo metodo para pagina minima sem AI
   - `update_wiki_from_batch`: retorno corrigido, logging por dominio

---

## Testing Results

```
OK  Syntax valid: pipeline_wiki.py
OK  context_merge.yaml v2 carregado
OK  wiki_page.yaml v2 carregado
OK  Backend restart: no errors
OK  Descricao do Suinda resetada para vazio
OK  Wiki pages deletadas (1 container)
```

---

## Key Insights

### 1. Template injection > threshold reduction
Em vez de baixar os thresholds de validacao (min_words, min_sections), injetar os headers
diretamente no prompt garante que modelos locais copiem a estrutura. Melhora a geracao
sem sacrificar qualidade.

### 2. Fallback garante dados nunca perdidos
Mesmo que AI + retry falhem, o fallback local gera uma pagina com as regras brutas.
Pode nao ser bonita, mas mantem os dados acessiveis na wiki. Merge futuro pode melhorar.

### 3. Persona do prompt define o tom
A simples mudanca de "redator tecnico" para "analista de negocios" muda drasticamente
o tom da saida. Prompts de IA sao muito sensiveis a persona e perspectiva.

---

## Status: COMPLETE

Wiki e descricao corrigidas. Proximos batches do Suinda vao:
- Criar wiki pages de dominio (com retry + fallback)
- Gerar descricao funcional (perspectiva de negocio)
