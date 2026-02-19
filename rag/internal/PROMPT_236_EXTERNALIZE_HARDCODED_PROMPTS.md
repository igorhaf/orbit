# PROMPT #236 - Externalize Remaining Hardcoded Prompts to YAML
## Varredura completa e migracão de prompts hardcoded para sistema YAML

**Date:** February 19, 2026
**Status:** COMPLETED
**Priority:** HIGH
**Type:** Refactor
**Impact:** Todos os prompts de IA agora estão externalizados em YAML, facilitando manutencão e versionamento

---

## Objective

Realizar varredura completa do backend para identificar prompts de IA hardcoded em codigo Python e migra-los para o sistema de prompts YAML externalizado (PromptLoader), conforme regra PROMPT #103 do CLAUDE.md.

**Key Requirements:**
1. Identificar todos os prompts hardcoded no backend
2. Criar arquivos YAML para prompts novos
3. Atualizar YAMLs existentes que estavam incompletos
4. Migrar codigo Python para usar PromptLoader
5. Validar que todos os templates renderizam corretamente

---

## Analysis

### Prompts Hardcoded Encontrados: 8 em 5 arquivos

| Arquivo | Linhas | Tipo | YAML Existia? |
|---------|--------|------|---------------|
| `context_generator.py` L786-836 | system_prompt + user_prompt | Context analysis | Sim (incompleto) |
| `backlog_generator.py` L214-333 | system_prompt + user_prompt | Epic from interview | Sim (nao usado) |
| `meta_prompt_processor.py` L309-436 | system_prompt + user_prompt | Hierarchy generation | Nao |
| `ai_format.py` L60-76 | prompt unico | Markdown formatter | Nao |
| `convention_extractor.py` L196-227 | prompt unico | Convention extraction | Nao |
| `pattern_recognizer.py` L230-249 | prompt unico | Pattern extraction | Nao |
| `interview_handlers.py` L581 | system_prompt | Requirements analyst | Sim (nao usado) |
| `interview_handlers.py` L1050 | system_prompt | Orchestrator sections | Sim (nao usado) |
| `interview_handlers.py` L1231 | system_prompt | Meta prompt contextual | Sim (nao usado) |

---

## What Was Implemented

### 1. YAMLs Criados (4 novos)

- `backend/app/prompts/backlog/hierarchy_generation.yaml` - Geracao de hierarquia completa (Epic/Stories/Tasks/Subtasks) do Meta Prompt
- `backend/app/prompts/utility/markdown_formatter.yaml` - Conversao de texto plano para Markdown
- `backend/app/prompts/discovery/convention_extraction.yaml` - Extracao de convencoes de codigo
- `backend/app/prompts/discovery/pattern_extraction.yaml` - Extracao de templates reutilizaveis de codigo

### 2. YAML Atualizado (1 existente)

- `backend/app/prompts/context/context_generation.yaml` - Adicionada variavel `business_rules_section` e secao condicional no user_prompt

### 3. Codigo Python Migrado (7 arquivos)

Todos os prompts hardcoded substituidos por chamadas ao PromptLoader:

```python
# Padrão usado em todas as migracoes:
from app.prompts.loader import get_prompt_loader
_loader = get_prompt_loader()
system_prompt, user_prompt = _loader.render("category/prompt_name", {variables})
```

### 4. Tratamento de Jinja2 vs JSON

O YAML `hierarchy_generation.yaml` continha um exemplo JSON com `{ }` que Jinja2 interpretaria como expressoes. Resolvido com `{% raw %}...{% endraw %}` para proteger o bloco JSON literal.

---

## Files Modified/Created

### Created:
1. **backend/app/prompts/backlog/hierarchy_generation.yaml** - Hierarquia completa Meta Prompt
2. **backend/app/prompts/utility/markdown_formatter.yaml** - Formatador Markdown
3. **backend/app/prompts/discovery/convention_extraction.yaml** - Extracao de convencoes
4. **backend/app/prompts/discovery/pattern_extraction.yaml** - Extracao de padroes

### Modified:
1. **backend/app/prompts/context/context_generation.yaml** - Adicionada business_rules_section
2. **backend/app/services/context_generator.py** - Migrado para PromptLoader
3. **backend/app/services/backlog_generator.py** - Migrado para PromptLoader
4. **backend/app/services/meta_prompt_processor.py** - Migrado para PromptLoader
5. **backend/app/api/routes/ai_format.py** - Migrado para PromptLoader
6. **backend/app/services/convention_extractor.py** - Migrado para PromptLoader
7. **backend/app/services/pattern_recognizer.py** - Migrado para PromptLoader
8. **backend/app/api/routes/interview_handlers.py** - 3 prompts migrados para PromptLoader

---

## Testing Results

### Verification:

```bash
OK: Python syntax check - all 7 modified .py files
OK: YAML parse check - all 5 YAML files
OK: Jinja2 render test - all 8 templates render with correct variable substitution
```

---

## Success Metrics

- **8 prompts hardcoded eliminados** em 5 arquivos Python
- **4 novos YAMLs criados** + 1 YAML atualizado
- **100% dos prompts externalizados** - nenhum prompt hardcoded restante nos servicos principais
- **0 erros de sintaxe** em Python e YAML

---

## Key Insights

### 1. YAMLs existiam mas nao eram usados
5 dos 8 prompts ja tinham YAMLs correspondentes criados no PROMPT #103, mas o codigo Python nunca foi atualizado para usa-los. A migracao consistiu apenas em substituir o hardcoded pela chamada ao loader.

### 2. Jinja2 vs JSON literal
Quando o prompt contem exemplos JSON com `{ }`, e necessario usar `{% raw %}...{% endraw %}` para evitar conflito com a sintaxe Jinja2 `{{ }}`.

### 3. Pasta utility/ criada
Nova categoria `utility/` adicionada ao sistema de prompts para ferramentas de formatacao e transformacao de texto.

---

## Status: COMPLETE

**Key Achievements:**
- Varredura completa do backend identificou 8 prompts hardcoded
- Todos migrados para sistema YAML externalizado
- 4 novos templates YAML criados
- Validacao automatizada confirmou renderizacao correta

**Impact:**
- Manutencao de prompts agora e feita apenas editando arquivos YAML
- Versionamento e rastreabilidade de mudancas em prompts
- Total de YAMLs no sistema: ~71 (67 anteriores + 4 novos)
