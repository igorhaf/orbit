---
title: "REGRA #0: Dados Humanos São Sagrados"
slug: "regra-zero"
source: "generated"
order_index: 19
created_at: "2026-03-05T04:46:25.972454"
updated_at: "2026-03-05T04:46:25.972454"
---

# REGRA #0: Dados Humanos São Sagrados

## Princípio Fundamental

**Dados inseridos ou editados por um operador humano têm prioridade absoluta sobre dados gerados por IA.**

Esta regra se aplica a TODOS os locais do sistema sem exceção.

## Onde Se Aplica

### Cards (Tasks/Stories/Epics)
- Se `description_edited_by = 'human'`, AI **não** pode sobrescrever description
- Regeneração de backlog preserva cards editados manualmente
- Campo `created_by_ai_model` rastreia origem

### Wiki Pages
- Pages com `source = 'manual'` ou `source = 'enrichment'`: **NUNCA** sobrescritas
- Apenas `source = 'generated'` ou `source = 'bootstrap'` podem ser regeneradas
- Guard check em wiki_service antes de update

### Projetos
- Nome, descrição, e contexto editados manualmente preservados
- AI pode preencher campos vazios/null
- AI sugere, humano confirma quando há dado existente

## Implementação

```python
# CORRETO
if not task.description or task.description_edited_by != 'human':
    task.description = ai_new_description

# ERRADO
task.description = ai_new_description  # Pode sobrescrever dado humano!
```

## Logging
Quando dado humano é preservado sobre sugestão de AI, o sistema loga:
`"REGRA #0: Preserved human-edited {field} for {entity_type} {id}"`

