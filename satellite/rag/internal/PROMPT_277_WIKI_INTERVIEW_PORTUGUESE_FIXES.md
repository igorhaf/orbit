# PROMPT #277 - Correcoes Multiplas: Wiki Sidebar, Portugues, Entrevista, Validacao AI
## Fix de 4 problemas criticos pos-criacao de projeto

**Date:** 2026-02-14
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Bug Fix
**Impact:** Corrige 4 problemas criticos que afetavam a experiencia do usuario apos criar um novo projeto

---

## Objective

Corrigir 4 problemas reportados apos criacao de um novo projeto (Suinda):

1. **Description com conteudo incoerente**: AI gerou codigo maze-generator.py como descricao do projeto
2. **Wiki sidebar poluida**: Todas as regras de negocio (`regra-*`) apareciam como itens root no menu lateral
3. **Textos em ingles**: AI gerando conteudo em ingles mesmo com instrucoes para portugues
4. **Entrevista com redirect loop**: Click na tab Interview ia para setup-context mas redirecionava de volta

---

## What Was Implemented

### 1. Fix Entrevista - Redirect Loop

**Causa raiz:** `generate_rich_context_from_memory()` em `context_generator.py:5920` seta `project.context_human` automaticamente durante o pipeline de criacao. O `setup-context/page.tsx` checava `context_locked || context_human` e redirecionava de volta, impedindo a entrevista.

**Correcao:** Removido check de `context_human` no redirect. Apenas `context_locked` (setado explicitamente apos conclusao da entrevista) deve bloquear o setup-context.

**Arquivo:** `frontend/src/app/projects/[id]/setup-context/page.tsx` (linha 67)

### 2. Fix Wiki Sidebar - Hierarquia de Paginas

**Causa raiz:** Paginas `regras-catalogo-bruto` criadas sem `parent_id` em 2 locais, e `regras-de-negocio` nao existia quando `_build_business_rules_wiki_pages()` rodava.

**Correcao:**
- `wiki.py`: `_build_business_rules_wiki_pages()` agora cria `regras-de-negocio` como stub se nao existir
- `wiki.py`: `generate_wiki_from_context()` agora seta `parent_id` em `regras-catalogo-bruto`
- `projects.py`: `_enrich_context_from_rag()` agora busca parent e seta `parent_id`
- SQL: Corrigidos 46 paginas orfas existentes no banco

**Arquivos:** `backend/app/api/routes/wiki.py`, `backend/app/api/routes/projects.py`

### 3. Reforco de Portugues nos Prompts

**Causa raiz:** Instrucoes de portugues fracas nos prompts YAML. Modelos locais (Ollama Gemma3/Qwen3) ao processar codigo em ingles tendiam a responder em ingles.

**Correcao:** Adicionada instrucao forte "IDIOMA OBRIGATORIO" no final de `system_prompt` e `user_prompt` em 9 arquivos YAML.

**Arquivos modificados:**
- `backend/app/prompts/memory/codebase_analysis.yaml`
- `backend/app/prompts/memory/consolidation.yaml`
- `backend/app/prompts/context/wiki_enrichment.yaml`
- `backend/app/prompts/context/wiki_rule_enrichment.yaml`
- `backend/app/prompts/context/rich_context_architecture.yaml`
- `backend/app/prompts/context/rich_context_business_domain.yaml`
- `backend/app/prompts/context/rich_context_features.yaml`
- `backend/app/prompts/context/rich_context_consolidation.yaml`
- `backend/app/prompts/memory/continuous_rag_extract.yaml`

### 4. Validacao de Resposta AI antes de Salvar Descricao

**Causa raiz:** Qualquer resposta AI >100 chars era salva como `project.description` sem validar conteudo. AI podia gerar codigo de exemplo (maze-generator.py) e ser salvo como descricao.

**Correcao:** Adicionada validacao que checa presenca de secoes esperadas (visao geral, stack, arquitetura, regras, features) antes de salvar.

**Arquivos:** `backend/app/api/routes/projects.py`, `backend/app/services/context_generator.py`

---

## Files Modified

### Frontend:
1. **`frontend/src/app/projects/[id]/setup-context/page.tsx`** - Removido `context_human` do check de redirect (1 linha)

### Backend:
2. **`backend/app/api/routes/wiki.py`** - Criacao de `regras-de-negocio` stub + parent_id em `regras-catalogo-bruto`
3. **`backend/app/api/routes/projects.py`** - Validacao de resposta AI + parent_id em `regras-catalogo-bruto`
4. **`backend/app/services/context_generator.py`** - Validacao de resposta AI antes de salvar descricao

### Prompts YAML (9 arquivos):
5. **`backend/app/prompts/memory/codebase_analysis.yaml`** - Reforco de portugues
6. **`backend/app/prompts/memory/consolidation.yaml`** - Reforco de portugues
7. **`backend/app/prompts/context/wiki_enrichment.yaml`** - Reforco de portugues
8. **`backend/app/prompts/context/wiki_rule_enrichment.yaml`** - Reforco de portugues
9. **`backend/app/prompts/context/rich_context_architecture.yaml`** - Reforco de portugues
10. **`backend/app/prompts/context/rich_context_business_domain.yaml`** - Reforco de portugues
11. **`backend/app/prompts/context/rich_context_features.yaml`** - Reforco de portugues
12. **`backend/app/prompts/context/rich_context_consolidation.yaml`** - Reforco de portugues
13. **`backend/app/prompts/memory/continuous_rag_extract.yaml`** - Reforco de portugues

### SQL (dados existentes):
14. **UPDATE wiki_pages** - 46 paginas orfas corrigidas com parent_id correto

---

## Testing Results

```
OK  Wiki sidebar: apenas 9 paginas root (Visao Geral, Stack, Arquitetura, etc.)
OK  Zero paginas regra-* como root no sidebar
OK  46 paginas orfas corrigidas via SQL
OK  regras-catalogo-bruto e regras-indice com parent_id correto
OK  Redirect do setup-context checa apenas context_locked
OK  Validacao de descricao rejeita conteudo sem secoes esperadas
OK  9 prompts YAML com instrucao forte de portugues
```

---

## Success Metrics

- **Wiki sidebar limpo**: 46 paginas orfas removidas do root
- **Entrevista funcional**: Redirect loop eliminado
- **Descricao protegida**: Validacao impede conteudo incoerente
- **Portugues reforcado**: 9 prompts com instrucao obrigatoria

---

## Key Insights

### 1. context_human vs context_locked
O pipeline de criacao de projeto seta `context_human` automaticamente (via `generate_rich_context_from_memory()`), mas isso nao deve impedir a entrevista. Apenas `context_locked` (setado apos conclusao da entrevista ou ativacao do primeiro Epic) deve bloquear o setup-context.

### 2. Modelos locais e idioma
Modelos Ollama locais (Gemma3, Qwen3) tendem a responder no idioma do input. Ao processar codigo em ingles, precisam de instrucoes MUITO fortes no final do prompt para garantir resposta em portugues.

### 3. Hierarquia wiki precisa de parent garantido
Ao criar paginas filhas, o parent DEVE existir antes. A funcao `_build_business_rules_wiki_pages()` agora cria o parent `regras-de-negocio` automaticamente se nao existir.

---

## Status: COMPLETE

**Key Achievements:**
- 4 problemas criticos corrigidos em uma unica sessao
- 46 paginas wiki orfas corrigidas no banco de dados
- 13 arquivos modificados (1 frontend, 3 backend, 9 YAML)
- Validacao preventiva contra descricoes incoerentes
- Portugues reforcado em todos os prompts de memoria/contexto
