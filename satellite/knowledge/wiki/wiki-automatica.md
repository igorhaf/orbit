---
title: "Sistema de Wiki Automática"
slug: "wiki-automatica"
source: "generated"
order_index: 9
created_at: "2026-03-05T04:46:25.250125"
updated_at: "2026-03-05T04:46:25.250125"
---

# Sistema de Wiki Automática

## Dual Persistence

Wiki pages são armazenadas em dois locais:
1. **PostgreSQL** (tabela `wiki_pages`) — source of truth para queries
2. **Filesystem** (`satellite/knowledge/wiki/*.md`) — git tracking e edição externa

### YAML Front Matter
```yaml
---
title: "Nome da Página"
slug: "nome-da-pagina"
source: "generated"  # generated | manual | enrichment | bootstrap
order_index: 1
created_at: "2026-03-05T00:00:00"
updated_at: "2026-03-05T00:00:00"
---
```

## REGRA #0 Protection
- Pages com `source='manual'` ou `source='enrichment'` **NUNCA** são sobrescritas
- Geração automática só atualiza pages com `source='generated'` ou `source='bootstrap'`
- Guard check em wiki_service antes de qualquer update

## AI Operations

| Operação | Descrição |
|----------|-----------|
| Generate | Cria página do zero usando RAG context |
| Expand | Adiciona detalhes a seção existente |
| Summarize | Condensa conteúdo mantendo pontos-chave |
| Rephrase | Reescreve para tom diferente |

## UUID Determinístico
- UUID5(project_id + ":" + slug)
- Mesmo slug sempre gera mesmo UUID
- Permite idempotência na geração

