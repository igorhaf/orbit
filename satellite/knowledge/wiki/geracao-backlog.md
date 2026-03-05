---
title: "Geração de Backlog"
slug: "geracao-backlog"
source: "generated"
order_index: 7
created_at: "2026-03-05T04:46:25.087235"
updated_at: "2026-03-05T04:46:25.087235"
---

# Geração Hierárquica de Backlog

## Hierarquia de Cards

```
Epic (8-21 SP)
  └── Story (3-13 SP)
       └── Task (1-5 SP)
```

## Semantic Reference Methodology

Cada card usa identificadores semânticos para rastreabilidade:
- **N1-Nn**: Necessidades (needs) identificadas
- **P1-Pn**: Problemas (problems) detectados
- **E1-En**: Expectativas (expectations) do stakeholder
- **AC1-ACn**: Critérios de aceitação (acceptance criteria)

### Herança
- Epic define N, P, E → Stories herdam e refinam
- Stories definem ACs → Tasks implementam ACs específicos

## Dual Description

Cada card tem dois campos:
1. **description_markdown**: Rich format com referências semânticas, AC, detalhes técnicos (para AI)
2. **description**: Plain text legível (para display humano)

## Deduplicação

- RAGService.find_similar_cards() antes de criar
- Threshold: 0.90 cosine similarity
- Se match, retorna card existente (não cria duplicata)
- Fibonacci validation: apenas 1, 2, 3, 5, 8, 13, 21

## REGRA #0 para Cards
- Cards com `description_edited_by = 'human'` nunca sobrescritos
- Regeneração preserva edições manuais
- Campo `created_by_ai_model` para tracking de origem

