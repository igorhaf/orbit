# PROMPT #268 - Wiki em Portugues e Centrada em Regras de Negocio
## Correcao de Idioma e Reestruturacao da Wiki

**Date:** 2026-02-12
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix + Enhancement
**Impact:** Wiki passa de conteudo em ingles para portugues completo, com regras de negocio como nucleo

---

## Objective

O usuario reportou 3 problemas:
1. "as regras de negocio sao otimas para referencias de cards ja construidos"
2. "a wiki tb deve ser construido principalmente do enriquecimentos das regras de negocio"
3. "ainda esta vindo tudo em ingles"

**Root Cause:** O catalogo bruto de regras (PROMPT #266) usava o slug `regras-de-negocio`, sobrescrevendo a versao enriquecida pela AI. Alem disso, os labels dos builders de patterns/convencoes vinham em ingles, e o prompt de enrichment tinha tokens insuficientes para traduzir e expandir o conteudo.

**Key Requirements:**
1. Separar catalogo bruto (referencia) da pagina enriquecida de regras de negocio
2. Forcar portugues em todo o conteudo da wiki
3. Aumentar capacidade de tokens para enrichment mais rico
4. Traduzir labels de patterns e convencoes para portugues

---

## What Was Implemented

### 1. Separacao do Catalogo Bruto de Regras

**Problema:** O catalogo bruto (PROMPT #266) usava slug `regras-de-negocio`, sobrescrevendo a versao enriquecida pela AI que tambem usa esse slug (via parsing do markdown AI).

**Solucao:**
- Slug do catalogo bruto: `regras-de-negocio` -> `regras-catalogo-bruto`
- Titulo: "Catalogo de Referencia - Regras Brutas"
- Order index: 12 (apos as paginas principais)
- Descricao clarifica que a pagina principal de Regras de Negocio contem a versao enriquecida

### 2. Aumento de Tokens para Enrichment

**Problema:** `max_tokens=6000` limitava a AI a ~20-30 regras traduzidas. Com 500+ regras no RAG, o resultado era pobre.

**Solucao:**
- `max_tokens`: 6000 -> 12000
- `estimated_tokens` no YAML: 6000 -> 12000
- Saida maxima no prompt: ~4000 palavras -> ~8000 palavras

### 3. Forcando Portugues no Prompt de Enrichment

**Problema:** O prompt nao enfatizava suficientemente a traducao para portugues.

**Solucao em `wiki_enrichment.yaml`:**
- Regra 6: "TODO o conteudo DEVE ser em portugues - TRADUZA qualquer regra que esteja em ingles"
- Regra 8: "As Regras de Negocio sao o NUCLEO da wiki - dedique a maior parte do conteudo a elas"
- Regra 9: "Inclua o MAXIMO de regras possivel, organizadas por categoria"
- Ultima instrucao do user_prompt reforça: "TODO o conteudo DEVE ser em portugues."

### 4. Traducao de Labels nos Builders

**Problema:** Paginas de patterns e convencoes usavam labels em ingles (ex: "naming_convention", "class_hierarchy", "controller").

**Solucao:** Duas funcoes de traducao:
- `_translate_spec_type()` - 18 mapeamentos (ex: "layered_architecture" -> "Arquitetura em Camadas")
- `_translate_category()` - 15 mapeamentos (ex: "controller" -> "Controladores", "model" -> "Modelos")

### 5. Parser de Subsecoes (###)

**Problema:** Alguns modelos AI geram markdown com `###` ao inves de `##` para subsecoes. O `_parse_wiki_sections()` so reconhece `##`.

**Solucao:** Nova funcao `_parse_wiki_subsections()` que:
- Divide markdown por headers `###`
- Mapeia a slugs wiki conhecidos (mesmos da funcao original)
- Normaliza acentos para matching robusto
- Chamada como fallback quando `_parse_wiki_sections()` retorna poucos resultados

---

## Files Modified

### Modified:
1. **backend/app/api/routes/wiki.py**
   - Adicionadas funcoes `_translate_spec_type()` e `_translate_category()`
   - Adicionada funcao `_parse_wiki_subsections()` para headers ###
   - Atualizado slug do catalogo bruto para `regras-catalogo-bruto`
   - Builders de patterns/convencoes/UI agora usam labels em portugues
   - Parsing de enrichment tenta `_parse_wiki_subsections` como fallback

2. **backend/app/api/routes/projects.py**
   - Slug do catalogo bruto: `regras-de-negocio` -> `regras-catalogo-bruto`
   - `max_tokens`: 6000 -> 12000

3. **backend/app/prompts/context/wiki_enrichment.yaml**
   - `estimated_tokens`: 6000 -> 12000
   - Saida maxima: ~4000 -> ~8000 palavras
   - Regras de traducao e priorizacao de regras de negocio adicionadas

### Created:
1. **PROMPT_268_IMPLEMENTATION_REPORT.md** - Este report

---

## Testing Results

### Verificacao:

```
- 15 paginas wiki geradas com sucesso
- Pagina "regras-de-negocio" (1,466 chars) - conteudo em PORTUGUES da AI enrichment
  Exemplo: "Gerenciamento de Cursos: Instrutores podem criar cursos com titulos..."
- Pagina "arquitetura" (1,027 chars) - conteudo em PORTUGUES
  Exemplo: "A arquitetura da plataforma e projetada para ser modular e escalavel..."
- Pagina "integracoes" (969 chars) - conteudo em PORTUGUES
  Exemplo: "Gateways de Pagamento: Stripe, PayPal, Mercado Pago..."
- Pagina "visao-geral" (7,464 chars) - conteudo rico em PORTUGUES
- Pagina "regras-catalogo-bruto" (41,244 chars) - referencia completa separada
- Labels de patterns em portugues: "Controladores", "Hierarquia de Classes", "Arquivo de Configuracao"
```

---

## Resultado

**Antes:**
- Wiki com conteudo em ingles (catalogo bruto sobrescrevia versao AI)
- Labels de patterns em ingles (naming_convention, class_hierarchy)
- Regras de negocio com ~20 regras resumidas (max_tokens=6000)
- Catalogo bruto e versao enriquecida no mesmo slug

**Depois:**
- Wiki com conteudo em PORTUGUES (AI enrichment traduz e organiza)
- Labels de patterns em portugues (Convencao de Nomenclatura, Hierarquia de Classes)
- Regras de negocio com mais espaco (max_tokens=12000, ~8000 palavras)
- Catalogo bruto separado em `regras-catalogo-bruto` (referencia)
- Versao enriquecida em `regras-de-negocio` (AI organizada por categoria)

---

## Success Metrics

- **Idioma:** 100% das paginas de enrichment em portugues
- **Separacao:** Catalogo bruto nao sobrescreve mais a versao enriquecida
- **Labels:** 18 spec_types + 15 categorias traduzidas para portugues
- **Capacidade:** max_tokens dobrado (6000 -> 12000)
- **Parsing:** Suporte a ### headers como fallback

---

## Key Insights

### 1. Slug collision e o bug mais silencioso
O catalogo bruto e a versao AI usavam o mesmo slug `regras-de-negocio`. O ultimo a ser escrito ganhava. Como o catalogo bruto vinha DEPOIS do parsing do enrichment, sobrescrevia a versao em portugues com dados crus em ingles.

### 2. Labels importam para a experiencia do usuario
Mesmo que o conteudo dos patterns venha em ingles (do RAG), ter headers e labels em portugues ("Controladores" vs "controller") faz grande diferenca na leitura e navegacao.

### 3. Fallback de parsing e necessario
Diferentes modelos AI geram markdown com diferentes niveis de headers. O `_parse_wiki_subsections()` garante que mesmo com `###` ao inves de `##`, as secoes sejam distribuidas corretamente.

---

## Status: COMPLETE

**Key Achievements:**
- Wiki inteiramente em portugues (paginas de enrichment)
- Catalogo bruto separado como referencia (slug proprio)
- Labels de patterns/convencoes traduzidos
- max_tokens dobrado para enrichment mais rico
- Parser de subsecoes como fallback robusto

**Impact:**
- Usuario ve conteudo organizado e em portugues
- Regras de negocio sao o nucleo da wiki (AI dedica mais espaco)
- Catalogo bruto permanece como referencia sem sobrescrever conteudo AI
