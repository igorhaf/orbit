# PROMPT #269 - Paginas Wiki Individuais por Regra de Negocio
## Hierarquia Completa: Indice -> Dominios -> Regras Individuais

**Date:** 2026-02-13
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Feature Enhancement
**Impact:** Cada regra de negocio agora tem pagina wiki propria, navegavel por dominio

---

## Objective

O usuario pediu que cada regra de negocio extraida do codebase se torne uma pagina wiki individual com conteudo rico. A estrutura deve ser hierarquica:

1. Pagina indice listando todos os dominios
2. Pagina por dominio com bullets clicaveis de cada regra
3. Pagina individual por regra com descricao rica

**Key Requirements:**
1. Classificar regras automaticamente em dominios (Aluno, Cursos, Instrutor, etc)
2. Criar hierarquia usando parent_id do modelo WikiPage
3. Deduplificar regras com conteudo identico
4. Integrar na geracao manual e automatica

---

## What Was Implemented

### 1. Classificacao de Dominio (_classify_domain)

Funcao que mapeia o path do arquivo fonte de cada regra para um dominio de negocio. Usa lista de 44 fragmentos de path mapeados para 20 dominios:

- Aluno, Aulas, Autenticacao, Avaliacoes, Categorias, Certificados
- Configuracao, Cursos, Geral, Inscricoes, Instrutor, Mensagens
- Modelos, Notificacoes, Pagamentos, Planos, Rotas, Trilhas, Validacao, Ajuda

### 2. Geracao Hierarquica (_build_business_rules_wiki_pages)

Funcao que cria toda a hierarquia de paginas:

**Nivel 1 - Indice:** Pagina `regras-indice` com lista de dominios e contagem de regras por dominio. Parent: `regras-de-negocio`.

**Nivel 2 - Dominios:** 20 paginas (ex: `regras-aluno`, `regras-cursos`), cada uma com regras agrupadas por arquivo fonte, bullets com links para paginas individuais. Parent: `regras-indice`.

**Nivel 3 - Regras Individuais:** 1006 paginas (ex: `regra-1713276e`), cada uma com:
- Titulo da regra
- Dominio e arquivo fonte
- Descricao completa
- Contexto explicativo

Deduplicacao por MD5 hash do conteudo evita paginas duplicadas.

### 3. Integracao

Chamada integrada em ambos os fluxos:
- **Manual:** `generate_wiki_from_context()` em wiki.py
- **Automatico:** `_enrich_context_from_rag()` em projects.py

---

## Files Modified

### Modified:
1. **backend/app/api/routes/wiki.py**
   - Adicionado `_DOMAIN_MAP` (44 fragmentos -> 20 dominios)
   - Adicionada funcao `_classify_domain()`
   - Adicionada funcao `_build_business_rules_wiki_pages()` (~130 linhas)
   - Integrada chamada em `generate_wiki_from_context()`

2. **backend/app/api/routes/projects.py**
   - Adicionado import de `_build_business_rules_wiki_pages`
   - Integrada chamada em `_enrich_context_from_rag()`

### Created:
1. **PROMPT_269_IMPLEMENTATION_REPORT.md** - Este report

---

## Testing Results

### Verificacao:

```
- 1042 paginas wiki geradas no total
- 1006 paginas individuais de regras
- 20 paginas de dominio (Aluno: 205, Cursos: 120, Instrutor: 171, etc)
- 1 pagina indice com lista de dominios
- 15 paginas existentes mantidas (visao-geral, stack, etc)
- Hierarquia parent_id verificada:
  regras-de-negocio -> regras-indice -> regras-aluno -> regra-xxx
- Deduplicacao: 1030 regras RAG -> 1006 paginas unicas (24 duplicatas removidas)
```

---

## Hierarquia Final

```
regras-de-negocio (enrichment AI, 1436 chars)
  regras-indice (20 dominios listados)
    regras-ajuda (10 regras)
    regras-aluno (205 regras)
      regra-1713276e -> "Certificates are filtered by the user's ID"
      regra-0945e174 -> "Certificate issuance date sorted descending"
      ... (203 mais)
    regras-aulas (85 regras)
    regras-autenticacao (31 regras)
    regras-avaliacoes (12 regras)
    regras-categorias (40 regras)
    regras-certificados (16 regras)
    regras-configuracao (101 regras)
    regras-cursos (120 regras)
    regras-geral (22 regras)
    regras-inscricoes (7 regras)
    regras-instrutor (171 regras)
    regras-mensagens (16 regras)
    regras-modelos (24 regras)
    regras-notificacoes (11 regras)
    regras-pagamentos (8 regras)
    regras-planos (12 regras)
    regras-rotas (19 regras)
    regras-trilhas (72 regras)
    regras-validacao (24 regras)
```

---

## Success Metrics

- **Paginas individuais:** 1006 regras com pagina propria
- **Dominios:** 20 dominios auto-classificados
- **Hierarquia:** 3 niveis de profundidade (indice -> dominio -> regra)
- **Deduplicacao:** 24 regras duplicadas removidas automaticamente
- **Navegacao:** Links clicaveis entre dominios e regras

---

## Key Insights

### 1. Deduplicacao e essencial em escala
Com 1030 regras, havia duplicatas de conteudo identico extraido de arquivos diferentes. A deduplicacao por MD5 preveniu violacoes de unique constraint.

### 2. Slugs estaveis baseados em conteudo
Usar MD5 do conteudo como slug (regra-1713276e) garante que a mesma regra sempre gere o mesmo slug, mesmo em re-geracoes. Isso permite upsert seguro.

### 3. Classificacao por path e suficiente
Os paths dos arquivos fonte ja contem informacao semantica rica (Controllers/Aluno/, Models/, Requests/) que permite classificacao precisa em dominios sem necessidade de AI.

---

## Status: COMPLETE

**Key Achievements:**
- 1006 paginas wiki individuais por regra de negocio
- 20 dominios auto-classificados com navegacao hierarquica
- Hierarquia parent_id completa (3 niveis)
- Deduplicacao automatica de regras
- Integrado em ambos os fluxos (manual e automatico)
